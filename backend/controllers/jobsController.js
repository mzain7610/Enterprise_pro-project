// If you have employer job edit/delete endpoints, add logJobAction calls there as well for full audit.
// Utility: Log job actions to job_action_logs
const logJobAction = (jobId, userId, userRole, action, details = null) => {
  if (!jobId || !userId || !userRole || !action) return;
  const detailsStr = details ? (typeof details === "string" ? details : JSON.stringify(details)) : null;
  db.query(
    "INSERT INTO job_action_logs (job_id, user_id, user_role, action, details) VALUES (?, ?, ?, ?, ?)",
    [jobId, userId, userRole, action, detailsStr],
    () => {}
  );
};

const db = require("../config/mysql");
const { notifyShiftAlerts } = require("../utils/shiftAlerts");
const { getPlatformSetting, toBooleanSetting } = require("../utils/platformSettings");

const isMissingColumnError = (err) => {
  return !!err && (err.code === "ER_BAD_FIELD_ERROR" || /Unknown column/i.test(err.message || ""));
};

const ensureCompanyVerificationColumns = () => {
  const columns = [
    {
      name: "verification_status",
      ddl: "ALTER TABLE companies ADD COLUMN verification_status VARCHAR(20) NOT NULL DEFAULT 'pending'"
    },
    {
      name: "verification_notes",
      ddl: "ALTER TABLE companies ADD COLUMN verification_notes TEXT NULL"
    },
    {
      name: "verified_by_admin_id",
      ddl: "ALTER TABLE companies ADD COLUMN verified_by_admin_id INT NULL"
    },
    {
      name: "verified_at",
      ddl: "ALTER TABLE companies ADD COLUMN verified_at DATETIME NULL"
    }
  ];

  columns.forEach((col) => {
    db.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = ?
       LIMIT 1`,
      [col.name],
      (checkErr, rows) => {
        if (checkErr || rows?.length) return;
        db.query(col.ddl, () => {});
      }
    );
  });
};

ensureCompanyVerificationColumns();

/* ===============================
   JOB MODERATION (AUTO-APPROVAL)
================================ */
const AUTO_APPROVAL_ENABLED = process.env.AUTO_APPROVE_JOBS !== "false";
const AUTO_APPROVE_MIN_SCORE = Number(process.env.AUTO_APPROVE_MIN_SCORE || 70);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const parseAiJson = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (nestedErr) {
      return null;
    }
  }
};

const evaluateJobWithOpenAI = async ({ title, description, location, jobType, category }) => {
  if (!OPENAI_API_KEY || typeof fetch !== "function") return null;

  const prompt = `You are a job moderation classifier. Determine if this job looks fake/scam.
Return strict JSON only:
{"verdict":"safe|fake|uncertain","confidence":0-100,"reason":"short reason"}

Job:
Title: ${title}
Location: ${location}
Type: ${jobType}
Category: ${category}
Description: ${description}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) return null;
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content || "";
    const parsed = parseAiJson(content);
    if (!parsed) return null;

    const verdict = String(parsed.verdict || "uncertain").toLowerCase();
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence || 0)));
    const reason = String(parsed.reason || "").slice(0, 220);

    if (!["safe", "fake", "uncertain"].includes(verdict)) return null;
    return { verdict, confidence, reason };
  } catch (err) {
    return null;
  }
};

const evaluateJobModeration = async ({ title, description, location, jobType, category, autoApprovalEnabled }) => {
  const text = `${title} ${description} ${location} ${jobType} ${category}`.toLowerCase();
  const reasons = [];
  let score = 100;

  if (!description || description.length < 50) {
    score -= 35;
    reasons.push("description too short");
  }

  if (description && description.length < 120) {
    score -= 10;
    reasons.push("low detail in description");
  }

  const suspiciousRules = [
    { regex: /easy\s*money|no\s*experience\s*needed|instant\s*income/, penalty: 30, reason: "unrealistic earning claims" },
    { regex: /pay\s*fee|registration\s*fee|processing\s*fee|deposit\s*required/, penalty: 45, reason: "asks candidates for payment" },
    { regex: /click\s*link|dm\s*me|telegram|whatsapp|signal\s*me/, penalty: 25, reason: "off-platform contact pressure" },
    { regex: /crypto|bitcoin|usdt|wire\s*transfer/, penalty: 20, reason: "risky payment keywords" },
    { regex: /urgent\s*hire\s*today|limited\s*spots\s*only/, penalty: 10, reason: "high-pressure language" }
  ];

  suspiciousRules.forEach((rule) => {
    if (rule.regex.test(text)) {
      score -= rule.penalty;
      reasons.push(rule.reason);
    }
  });

  const looksLikePlaceholder = /lorem ipsum|test job|asdf|qwerty/.test(text);
  if (looksLikePlaceholder) {
    score -= 40;
    reasons.push("placeholder content detected");
  }

  if (!location || location.length < 2) {
    score -= 10;
    reasons.push("missing clear location");
  }

  if (!jobType || jobType.length < 2) {
    score -= 10;
    reasons.push("missing clear job type");
  }

  const aiAssessment = await evaluateJobWithOpenAI({ title, description, location, jobType, category });
  if (aiAssessment) {
    if (aiAssessment.verdict === "fake" && aiAssessment.confidence >= 70) {
      score -= 40;
      reasons.push(`ai flagged suspicious: ${aiAssessment.reason}`);
    }

    if (aiAssessment.verdict === "safe" && aiAssessment.confidence >= 70) {
      score += 5;
      reasons.push("ai confidence indicates likely legitimate posting");
    }
  }

  score = Math.max(0, Math.min(100, score));

  const autoApproved = autoApprovalEnabled && score >= AUTO_APPROVE_MIN_SCORE;
  const status = autoApproved ? "approved_auto" : "pending_manual_review";
  const reasonText = reasons.length ? reasons.join("; ") : "passed automatic moderation checks";

  return {
    score,
    autoApproved,
    status,
    reasonText,
    aiAssessment
  };
};

exports.getJobs = (req, res) => {
  const { location, job_type, category, keyword, company_id, salary_min, salary_max, experience_level, is_remote, is_shift } = req.query;

  const buildQuery = ({ includeDeadlineColumn }) => {
    let sql = "SELECT j.*, c.name AS company_name, c.logo_url AS company_logo";
    const params = [];

    if (includeDeadlineColumn) {
      sql += ", (CASE WHEN j.application_deadline IS NULL OR j.application_deadline >= NOW() THEN 1 ELSE 0 END) AS is_open_for_applications";
    } else {
      sql += ", 1 AS is_open_for_applications";
    }

    if (req.user) {
      sql += ", (sj.id IS NOT NULL) AS is_saved";
    }

    sql += " FROM jobs j";
    sql += " LEFT JOIN companies c ON j.company_id = c.id";

    if (req.user) {
      sql += " LEFT JOIN saved_jobs sj ON sj.job_id = j.id AND sj.user_id = ?";
      params.push(req.user.id);
    }

    // show approved jobs plus any job owned by the current user (so they can see pending posts)
    sql += " WHERE (j.is_approved = 1";
    if (req.user) {
      sql += " OR j.posted_by = ?";
      params.push(req.user.id);
    }
    sql += ")";
    if (includeDeadlineColumn) {
      sql += " AND (j.application_deadline IS NULL OR j.application_deadline >= NOW())";
    }

    if (location) {
      sql += " AND j.location = ?";
      params.push(location);
    }

    if (job_type) {
      sql += " AND j.job_type = ?";
      params.push(job_type);
    }

    if (category) {
      sql += " AND j.category = ?";
      params.push(category);
    }

    if (company_id) {
      sql += " AND j.company_id = ?";
      params.push(company_id);
    }

    if (keyword) {
      sql += " AND (j.title LIKE ? OR j.description LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    // Note: salary_min, salary_max, experience_level, is_remote columns don't exist in current schema
    // These filters are skipped to avoid SQL errors

    if (is_shift === "1" || is_shift === "true") {
      sql += " AND j.is_shift = 1";
    }

    if (is_shift === "0" || is_shift === "false") {
      sql += " AND (j.is_shift = 0 OR j.is_shift IS NULL)";
    }

    sql += " ORDER BY j.is_premium DESC, j.created_at DESC";
    return { sql, params };
  };

  const primary = buildQuery({ includeDeadlineColumn: true });
  db.query(primary.sql, primary.params, (err, results) => {
    if (!err) return res.json(results);

    if (!isMissingColumnError(err)) {
      return res.status(500).json({ error: err.message });
    }

    const fallback = buildQuery({ includeDeadlineColumn: false });
    db.query(fallback.sql, fallback.params, (fallbackErr, fallbackResults) => {
      if (fallbackErr) return res.status(500).json({ error: fallbackErr.message });
      res.json(fallbackResults);
    });
  });
};

exports.getPortalStats = (req, res) => {
  const countJobsSql = "SELECT COUNT(*) AS total_jobs FROM jobs WHERE is_approved = 1";
  const countActiveJobsSql = "SELECT COUNT(*) AS active_jobs FROM jobs WHERE is_approved = 1 AND (application_deadline IS NULL OR application_deadline >= NOW())";
  const countCompaniesFromJobsSql = "SELECT COUNT(DISTINCT company_id) AS total_companies FROM jobs WHERE is_approved = 1 AND company_id IS NOT NULL";
  const countCompaniesSql = "SELECT COUNT(*) AS total_companies FROM companies";
  const applicationsStatsSql = `
    SELECT
      COUNT(*) AS total_applications,
      SUM(
        CASE
          WHEN LOWER(COALESCE(status, '')) IN ('accepted', 'hired') OR LOWER(COALESCE(pipeline_stage, '')) = 'hired'
          THEN 1
          ELSE 0
        END
      ) AS total_placements
    FROM applications
  `;
  const applicationsStatsFallbackSql = `
    SELECT
      COUNT(*) AS total_applications,
      SUM(
        CASE
          WHEN LOWER(COALESCE(status, '')) IN ('accepted', 'hired')
          THEN 1
          ELSE 0
        END
      ) AS total_placements
    FROM applications
  `;

  db.query(countJobsSql, [], (jobsErr, jobsRows) => {
    if (jobsErr) return res.status(500).json({ message: "Failed to load portal stats", error: jobsErr.message });
    const totalJobs = Number(jobsRows?.[0]?.total_jobs || 0);

    const continueWithActiveJobs = () => {
      db.query(countActiveJobsSql, [], (activeErr, activeRows) => {
        const activeJobs = activeErr && isMissingColumnError(activeErr)
          ? totalJobs
          : Number(activeRows?.[0]?.active_jobs || totalJobs);

        db.query(countCompaniesFromJobsSql, [], (companiesFromJobsErr, companiesFromJobsRows) => {
          if (companiesFromJobsErr) {
            if (companiesFromJobsErr.code === "ER_NO_SUCH_TABLE") {
              return res.status(500).json({ message: "Failed to load portal stats", error: companiesFromJobsErr.message });
            }
          }

          const jobsCompanyCount = Number(companiesFromJobsRows?.[0]?.total_companies || 0);
          const resolveCompanies = (callback) => {
            if (jobsCompanyCount > 0) return callback(jobsCompanyCount);
            db.query(countCompaniesSql, [], (companiesErr, companiesRows) => {
              if (companiesErr) {
                if (companiesErr.code === "ER_NO_SUCH_TABLE") return callback(jobsCompanyCount);
                return callback(jobsCompanyCount);
              }
              return callback(Number(companiesRows?.[0]?.total_companies || jobsCompanyCount));
            });
          };

          resolveCompanies((totalCompanies) => {
            db.query(applicationsStatsSql, [], (appsErr, appsRows) => {
              if (appsErr) {
                if (!isMissingColumnError(appsErr) && appsErr.code !== "ER_NO_SUCH_TABLE") {
                  return res.status(500).json({ message: "Failed to load portal stats", error: appsErr.message });
                }

                return db.query(applicationsStatsFallbackSql, [], (appsFallbackErr, appsFallbackRows) => {
                  if (appsFallbackErr) {
                    if (appsFallbackErr.code === "ER_NO_SUCH_TABLE") {
                      return res.json({
                        total_jobs: totalJobs,
                        active_jobs: activeJobs,
                        total_companies: totalCompanies,
                        total_placements: 0,
                        success_rate: 0
                      });
                    }
                    return res.status(500).json({ message: "Failed to load portal stats", error: appsFallbackErr.message });
                  }

                  const totalApplications = Number(appsFallbackRows?.[0]?.total_applications || 0);
                  const totalPlacements = Number(appsFallbackRows?.[0]?.total_placements || 0);
                  const successRate = totalApplications > 0
                    ? Math.round((totalPlacements / totalApplications) * 100)
                    : 0;

                  return res.json({
                    total_jobs: totalJobs,
                    active_jobs: activeJobs,
                    total_companies: totalCompanies,
                    total_placements: totalPlacements,
                    success_rate: successRate
                  });
                });
              }

              const totalApplications = Number(appsRows?.[0]?.total_applications || 0);
              const totalPlacements = Number(appsRows?.[0]?.total_placements || 0);
              const successRate = totalApplications > 0
                ? Math.round((totalPlacements / totalApplications) * 100)
                : 0;

              return res.json({
                total_jobs: totalJobs,
                active_jobs: activeJobs,
                total_companies: totalCompanies,
                total_placements: totalPlacements,
                success_rate: successRate
              });
            });
          });
        });
      });
    };

    continueWithActiveJobs();
  });
};

exports.getSalaryInsights = (req, res) => {
  const { location, job_type, category, keyword, company_id, experience_level, is_remote, is_shift } = req.query;

  const buildWhereClause = (includeDeadlineColumn) => {
    let where = " WHERE j.is_approved = 1";
    const params = [];

    if (includeDeadlineColumn) {
      where += " AND (j.application_deadline IS NULL OR j.application_deadline >= NOW())";
    }

    if (location) {
      where += " AND j.location = ?";
      params.push(location);
    }

    if (job_type) {
      where += " AND j.job_type = ?";
      params.push(job_type);
    }

    if (category) {
      where += " AND j.category = ?";
      params.push(category);
    }

    if (company_id) {
      where += " AND j.company_id = ?";
      params.push(company_id);
    }

    if (keyword) {
      where += " AND (j.title LIKE ? OR j.description LIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (experience_level) {
      where += " AND j.experience_level = ?";
      params.push(experience_level);
    }

    if (is_remote === "1" || is_remote === "true") {
      where += " AND j.is_remote = 1";
    }

    if (is_shift === "1" || is_shift === "true") {
      where += " AND j.is_shift = 1";
    }

    if (is_shift === "0" || is_shift === "false") {
      where += " AND (j.is_shift = 0 OR j.is_shift IS NULL)";
    }

    return { where, params };
  };

  const salaryExpr = `
    CASE
      WHEN j.salary_min IS NOT NULL AND j.salary_max IS NOT NULL THEN (j.salary_min + j.salary_max) / 2
      WHEN j.salary_min IS NOT NULL THEN j.salary_min
      WHEN j.salary_max IS NOT NULL THEN j.salary_max
      ELSE NULL
    END
  `;

  const runInsights = ({ includeDeadlineColumn, includeSalaryColumns }) => {
    const { where, params } = buildWhereClause(includeDeadlineColumn);

    const summarySql = includeSalaryColumns
      ? `
        SELECT
          COUNT(*) AS total_jobs,
          SUM(CASE WHEN j.salary_min IS NOT NULL OR j.salary_max IS NOT NULL THEN 1 ELSE 0 END) AS jobs_with_salary,
          ROUND(AVG(${salaryExpr})) AS avg_salary,
          ROUND(AVG(j.salary_min)) AS avg_salary_min,
          ROUND(AVG(j.salary_max)) AS avg_salary_max
        FROM jobs j
        ${where}
      `
      : `
        SELECT
          COUNT(*) AS total_jobs,
          0 AS jobs_with_salary,
          NULL AS avg_salary,
          NULL AS avg_salary_min,
          NULL AS avg_salary_max
        FROM jobs j
        ${where}
      `;

    const categorySql = includeSalaryColumns
      ? `
        SELECT
          j.category,
          COUNT(*) AS job_count,
          ROUND(AVG(${salaryExpr})) AS avg_salary
        FROM jobs j
        ${where}
          AND j.category IS NOT NULL
          AND TRIM(j.category) <> ''
        GROUP BY j.category
        ORDER BY job_count DESC, avg_salary DESC
        LIMIT 6
      `
      : `SELECT NULL AS category, 0 AS job_count, NULL AS avg_salary LIMIT 0`;

    const locationSql = includeSalaryColumns
      ? `
        SELECT
          j.location,
          COUNT(*) AS job_count,
          ROUND(AVG(${salaryExpr})) AS avg_salary
        FROM jobs j
        ${where}
          AND j.location IS NOT NULL
          AND TRIM(j.location) <> ''
        GROUP BY j.location
        ORDER BY job_count DESC, avg_salary DESC
        LIMIT 6
      `
      : `SELECT NULL AS location, 0 AS job_count, NULL AS avg_salary LIMIT 0`;

    const experienceSql = includeSalaryColumns
      ? `
        SELECT
          COALESCE(NULLIF(TRIM(j.experience_level), ''), 'Unspecified') AS experience_level,
          COUNT(*) AS job_count,
          ROUND(AVG(${salaryExpr})) AS avg_salary
        FROM jobs j
        ${where}
        GROUP BY COALESCE(NULLIF(TRIM(j.experience_level), ''), 'Unspecified')
        ORDER BY job_count DESC, avg_salary DESC
        LIMIT 8
      `
      : `SELECT 'Unspecified' AS experience_level, 0 AS job_count, NULL AS avg_salary LIMIT 0`;

    db.query(summarySql, params, (summaryErr, summaryRows) => {
      if (summaryErr) {
        if (includeSalaryColumns && isMissingColumnError(summaryErr)) {
          return runInsights({ includeDeadlineColumn, includeSalaryColumns: false });
        }
        if (includeDeadlineColumn && isMissingColumnError(summaryErr)) {
          return runInsights({ includeDeadlineColumn: false, includeSalaryColumns });
        }
        return res.status(500).json({ message: "Failed to load salary insights", error: summaryErr.message });
      }

      db.query(categorySql, params, (categoryErr, categoryRows) => {
        if (categoryErr) return res.status(500).json({ message: "Failed to load salary insights", error: categoryErr.message });

        db.query(locationSql, params, (locationErr, locationRows) => {
          if (locationErr) return res.status(500).json({ message: "Failed to load salary insights", error: locationErr.message });

          db.query(experienceSql, params, (experienceErr, experienceRows) => {
            if (experienceErr) return res.status(500).json({ message: "Failed to load salary insights", error: experienceErr.message });

            const summary = summaryRows[0] || {};
            return res.json({
              summary: {
                total_jobs: Number(summary.total_jobs || 0),
                jobs_with_salary: Number(summary.jobs_with_salary || 0),
                avg_salary: summary.avg_salary != null ? Number(summary.avg_salary) : null,
                avg_salary_min: summary.avg_salary_min != null ? Number(summary.avg_salary_min) : null,
                avg_salary_max: summary.avg_salary_max != null ? Number(summary.avg_salary_max) : null
              },
              top_categories: (categoryRows || []).map((row) => ({
                category: row.category,
                job_count: Number(row.job_count || 0),
                avg_salary: row.avg_salary != null ? Number(row.avg_salary) : null
              })),
              top_locations: (locationRows || []).map((row) => ({
                location: row.location,
                job_count: Number(row.job_count || 0),
                avg_salary: row.avg_salary != null ? Number(row.avg_salary) : null
              })),
              by_experience: (experienceRows || []).map((row) => ({
                experience_level: row.experience_level,
                job_count: Number(row.job_count || 0),
                avg_salary: row.avg_salary != null ? Number(row.avg_salary) : null
              }))
            });
          });
        });
      });
    });
  };

  return runInsights({ includeDeadlineColumn: true, includeSalaryColumns: true });
};

exports.getJobById = (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: "Invalid job id" });
  const params = [id];
  let sql = `
    SELECT j.*, c.name AS company_name, c.logo_url AS company_logo,
           (CASE WHEN j.application_deadline IS NULL OR j.application_deadline >= NOW() THEN 1 ELSE 0 END) AS is_open_for_applications
    FROM jobs j
    LEFT JOIN companies c ON j.company_id = c.id
    WHERE j.id = ?
      AND (
        j.is_approved = 1
  `;

  if (req.user && req.user.id) {
    sql += " OR j.posted_by = ?";
    params.push(req.user.id);
  }

  sql += `
      )
    LIMIT 1
  `;

  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!rows.length) return res.status(404).json({ message: "Job not found" });
    res.json(rows[0]);
  });
};

exports.addJob = (req, res) => {
  const title = (req.body.title || "").trim();
  const location = (req.body.location || "").trim();
  const jobType = (req.body.job_type || "").trim();
  const requestedCategory = (req.body.category || "").trim();
  const categoryCustom = (req.body.category_custom || "").trim();
  const category = requestedCategory.toLowerCase() === "other"
    ? categoryCustom
    : requestedCategory;
  const description = (req.body.description || "").trim();
  const isPremium = req.body.is_premium ? 1 : 0;
  const isShift = req.body.is_shift ? 1 : 0;
  const shiftStart = req.body.shift_start ? new Date(req.body.shift_start) : null;
  const shiftEnd = req.body.shift_end ? new Date(req.body.shift_end) : null;
  const shiftPayCents = req.body.shift_pay_cents ? Number(req.body.shift_pay_cents) : null;
  const shiftCurrency = (req.body.shift_currency || "usd").trim().toLowerCase();
  const applicationDeadlineRaw = (req.body.application_deadline || "").trim();
  const applicationDeadline = applicationDeadlineRaw ? new Date(applicationDeadlineRaw) : null;
  const userId = req.user ? req.user.id : null;
  const requestedCompanyId = req.body.company_id ? Number(req.body.company_id) : null;
  const bodyImageUrl = (req.body.image_url || "").trim();
  const isValidExternalUrl = bodyImageUrl && /^https?:\/\/.{4,}/.test(bodyImageUrl) && bodyImageUrl.length <= 500;
  const imageUrl = req.file
    ? "/uploads/jobs/" + req.file.filename
    : (isValidExternalUrl ? bodyImageUrl : null);

  const salaryMin = req.body.salary_min !== undefined && req.body.salary_min !== "" ? Math.max(0, Number(req.body.salary_min)) : null;
  const salaryMax = req.body.salary_max !== undefined && req.body.salary_max !== "" ? Math.max(0, Number(req.body.salary_max)) : null;
  const experienceLevel = (req.body.experience_level || "").trim().slice(0, 50);
  const isRemote = req.body.is_remote ? 1 : 0;
  const benefits = (req.body.benefits || "").trim().slice(0, 2000);

  if (!title || !location || !jobType || !category || !description) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (title.length > 200 || location.length > 200 || jobType.length > 100 || category.length > 100) {
    return res.status(400).json({ message: "One or more fields are too long" });
  }

  if (description.length < 20 || description.length > 5000) {
    return res.status(400).json({ message: "Description must be 20-5000 characters" });
  }

  if (applicationDeadline && isNaN(applicationDeadline.valueOf())) {
    return res.status(400).json({ message: "Invalid application deadline" });
  }

  if (applicationDeadline && applicationDeadline <= new Date()) {
    return res.status(400).json({ message: "Application deadline must be in the future" });
  }

  if (isShift) {
    if (!shiftStart || isNaN(shiftStart.valueOf())) {
      return res.status(400).json({ message: "Shift start time is required" });
    }
    if (!shiftEnd || isNaN(shiftEnd.valueOf())) {
      return res.status(400).json({ message: "Shift end time is required" });
    }
    if (!shiftPayCents || shiftPayCents <= 0) {
      return res.status(400).json({ message: "Shift pay is required" });
    }
  }

  if (!userId) {
    return res.status(401).json({ message: "Login required" });
  }

  const duplicateSql = `
    SELECT id, application_deadline
    FROM jobs
    WHERE posted_by = ?
      AND LOWER(TRIM(title)) = LOWER(TRIM(?))
      AND LOWER(TRIM(location)) = LOWER(TRIM(?))
      AND LOWER(TRIM(job_type)) = LOWER(TRIM(?))
      AND LOWER(TRIM(category)) = LOWER(TRIM(?))
      AND LOWER(TRIM(description)) = LOWER(TRIM(?))
      AND (application_deadline IS NULL OR application_deadline > NOW())
    ORDER BY created_at DESC
    LIMIT 1
  `;

  db.query(
    duplicateSql,
    [userId, title, location, jobType, category, description],
    (duplicateErr, duplicateRows) => {
      if (duplicateErr) return res.status(500).json({ error: duplicateErr.message });

      if (duplicateRows.length) {
        const existing = duplicateRows[0];
        const deadlineText = existing.application_deadline
          ? new Date(existing.application_deadline).toLocaleString()
          : "no deadline";

        return res.status(409).json({
          message: `A similar active job already exists (ID ${existing.id}) with ${deadlineText}. Update that job instead of reposting.`
        });
      }

      db.query("SELECT verified FROM users WHERE id = ?", [userId], (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!users.length) return res.status(404).json({ message: "User not found" });
        if (!users[0].verified) return res.status(403).json({ message: "Your employer account is pending admin verification. Once an admin approves your account you will be able to post jobs. Contact support@jobportal.com if you need help." });

    const insertJob = async (companyId) => {
      const autoApprovalRaw = await getPlatformSetting("auto_approve_jobs", String(AUTO_APPROVAL_ENABLED));
      const autoApprovalEnabled = toBooleanSetting(autoApprovalRaw, AUTO_APPROVAL_ENABLED);

      const moderation = await evaluateJobModeration({
        title,
        description,
        location,
        jobType,
        category,
        autoApprovalEnabled
      });

      const isApproved = moderation.autoApproved ? 1 : 0;
      const feePercent = Number(process.env.SHIFT_FEE_PERCENT || 10);
      const feeCents = isShift ? Math.max(0, Math.round(shiftPayCents * (feePercent / 100))) : null;
      const totalCents = isShift ? (shiftPayCents + feeCents) : null;

      db.query(
        `INSERT INTO jobs
          (title, location, job_type, category, description, is_premium, posted_by, company_id, is_approved,
           is_shift, shift_start, shift_end, shift_pay_cents, shift_fee_cents, shift_total_cents, shift_currency, shift_paid, shift_status,
           application_deadline, moderation_status, moderation_score, moderation_reason, auto_approved_at, image_url,
           salary_min, salary_max, experience_level, is_remote, benefits)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ,[
          title,
          location,
          jobType,
          category,
          description,
          isPremium,
          userId,
          companyId || null,
          isApproved,
          isShift,
          shiftStart,
          shiftEnd,
          isShift ? shiftPayCents : null,
          isShift ? feeCents : null,
          isShift ? totalCents : null,
          shiftCurrency,
          isShift ? 1 : 0,
          isShift ? "open" : "open",
          applicationDeadline,
          moderation.status,
          moderation.score,
          moderation.reasonText,
          moderation.autoApproved ? new Date() : null,
          imageUrl,
          Number.isFinite(salaryMin) ? salaryMin : null,
          Number.isFinite(salaryMax) ? salaryMax : null,
          experienceLevel || null,
          isRemote,
          benefits || null
        ],
        (err, result) => {
          if (!err && result && result.insertId) {
            logJobAction(result.insertId, userId, "employer", "created", { title, location, jobType, category });
          }
          if (err) {
            // Fallback: only if the missing column is image_url (legacy schema without that column).
            // Any other ER_BAD_FIELD_ERROR (e.g. salary_min missing) should surface as a real error.
            if (err.code === "ER_BAD_FIELD_ERROR" && (err.message || "").includes("image_url")) {
              return db.query(
                `INSERT INTO jobs
                  (title, location, job_type, category, description, is_premium, posted_by, company_id, is_approved,
                   is_shift, shift_start, shift_end, shift_pay_cents, shift_fee_cents, shift_total_cents, shift_currency, shift_paid, shift_status,
                   application_deadline, moderation_status, moderation_score, moderation_reason, auto_approved_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ,[
                  title, location, jobType, category, description, isPremium, userId, companyId || null, isApproved,
                  isShift, shiftStart, shiftEnd, isShift ? shiftPayCents : null, isShift ? feeCents : null,
                  isShift ? totalCents : null, shiftCurrency, isShift ? 1 : 0, "open", applicationDeadline,
                  moderation.status, moderation.score, moderation.reasonText, moderation.autoApproved ? new Date() : null
                ],
                (err2, result2) => {
                  if (err2) return res.status(500).json({ error: err2.message });
                  if (isShift) notifyShiftAlerts(result2.insertId, { status: "posted" });
                  res.status(201).json({
                    message: moderation.autoApproved ? "Job posted and auto-approved successfully" : "Job submitted successfully and is pending admin review",
                    auto_approved: moderation.autoApproved,
                    moderation: { score: moderation.score, status: moderation.status, reason: moderation.reasonText, ai: moderation.aiAssessment || null }
                  });
                }
              );
            }
            return res.status(500).json({ error: err.message });
          }
          if (isShift) {
            notifyShiftAlerts(result.insertId, { status: "posted" });
          }
          res.status(201).json({
            message: moderation.autoApproved
              ? "Job posted and auto-approved successfully"
              : "Job submitted successfully and is pending admin review",
            auto_approved: moderation.autoApproved,
            moderation: {
              score: moderation.score,
              status: moderation.status,
              reason: moderation.reasonText,
              ai: moderation.aiAssessment || null
            }
          });
        }
      );
    };

        const resolveAndValidateCompany = (targetCompanyId) => {
          const companySqlWithStatus = `
            SELECT id,
                   owner_user_id,
                   COALESCE(NULLIF(TRIM(verification_status), ''), 'pending') AS verification_status
            FROM companies
            WHERE ${targetCompanyId ? "id = ? AND" : ""} owner_user_id = ?
            ORDER BY created_at DESC
            LIMIT 1
          `;
          const params = targetCompanyId ? [targetCompanyId, userId] : [userId];

          db.query(companySqlWithStatus, params, (companyErr, companyRows) => {
            if (companyErr) {
              if (!isMissingColumnError(companyErr)) {
                return res.status(500).json({ error: companyErr.message });
              }

              const fallbackCompanySql = `
                SELECT id, owner_user_id
                FROM companies
                WHERE ${targetCompanyId ? "id = ? AND" : ""} owner_user_id = ?
                ORDER BY created_at DESC
                LIMIT 1
              `;
              return db.query(fallbackCompanySql, params, (fallbackErr, fallbackRows) => {
                if (fallbackErr) return res.status(500).json({ error: fallbackErr.message });
                if (!fallbackRows.length) {
                  return res.status(403).json({ message: targetCompanyId ? "Company not found for this user" : "Create and verify a company profile before posting jobs." });
                }
                return res.status(403).json({ message: "Your company is pending verification by admin. Please complete company details and wait for approval before posting jobs." });
              });
            }

            if (!companyRows.length) {
              return res.status(403).json({ message: targetCompanyId ? "Company not found for this user" : "Create and verify a company profile before posting jobs." });
            }

            const company = companyRows[0];
            const status = String(company.verification_status || "pending").toLowerCase();
            if (status !== "approved") {
              return res.status(403).json({ message: "Your company is pending verification by admin. Please complete company details and wait for approval before posting jobs." });
            }

            return insertJob(company.id);
          });
        };

        resolveAndValidateCompany(requestedCompanyId || null);
      });
    }
  );
};


exports.applyJob = (req, res) => {
  const { jobId, userId } = req.body;

  db.query("SELECT id FROM jobs WHERE id = ?", [jobId], (err, jobs) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!jobs.length) return res.status(404).json({ message: "Invalid job" });

    db.query(
      "INSERT INTO applications (job_id, user_id) VALUES (?, ?)",
      [jobId, userId],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ message: "Application submitted successfully" });
      }
    );
  });
};

/* ─── Report a job listing ──────────────────────────────────────── */
const VALID_REPORT_REASONS = ["spam", "fake", "misleading", "inappropriate", "other"];

exports.reportJob = (req, res) => {
  const jobId = Number(req.params.id);
  if (!jobId || isNaN(jobId)) {
    return res.status(400).json({ message: "Invalid job" });
  }

  const reason = (req.body.reason || "").trim().toLowerCase();
  const details = (req.body.details || "").trim().slice(0, 1000);

  if (!VALID_REPORT_REASONS.includes(reason)) {
    return res.status(400).json({ message: `Reason must be one of: ${VALID_REPORT_REASONS.join(", ")}` });
  }

  const userId = req.user ? req.user.id : null;

  // Ensure job_reports table exists (idempotent)
  const createTableSql = `
    CREATE TABLE IF NOT EXISTS job_reports (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      job_id     INT NOT NULL,
      user_id    INT,
      reason     VARCHAR(50) NOT NULL,
      details    TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_job_reports_job (job_id)
    )
  `;

  db.query(createTableSql, (createErr) => {
    if (createErr) {
      console.error("job_reports table create error:", createErr.message);
      return res.status(500).json({ message: "Database error" });
    }

    db.query(
      "INSERT INTO job_reports (job_id, user_id, reason, details) VALUES (?, ?, ?, ?)",
      [jobId, userId, reason, details || null],
      (insertErr) => {
        if (insertErr) {
          console.error("job_reports insert error:", insertErr.message);
          return res.status(500).json({ message: "Failed to submit report" });
        }
        res.json({ message: "Thank you — your report has been submitted and we'll review this listing." });

      }
    );
  });
};

// ─── Saved Searches ───────────────────────────────────────────────────────────

exports.getSavedSearches = (req, res) => {
  const userId = req.user.id;
  db.query(
    "SELECT id, name, filters, created_at FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: "DB error", error: err.message });
      res.json(rows.map(r => ({ ...r, filters: typeof r.filters === "string" ? JSON.parse(r.filters) : r.filters })));
    }
  );
};

exports.createSavedSearch = (req, res) => {
  const userId = req.user.id;
  const name = (req.body.name || "").trim().slice(0, 120);
  const filters = req.body.filters;

  if (!name) return res.status(400).json({ message: "Name is required" });
  if (!filters || typeof filters !== "object") return res.status(400).json({ message: "Filters must be an object" });

  const filtersJson = JSON.stringify(filters);

  db.query(
    "INSERT INTO saved_searches (user_id, name, filters) VALUES (?, ?, ?)",
    [userId, name, filtersJson],
    (err, result) => {
      if (err) return res.status(500).json({ message: "DB error", error: err.message });
      res.status(201).json({ id: result.insertId, name, filters });
    }
  );
};

exports.deleteSavedSearch = (req, res) => {
  const userId = req.user.id;
  const searchId = parseInt(req.params.id);
  if (!searchId) return res.status(400).json({ message: "Invalid id" });

  db.query(
    "DELETE FROM saved_searches WHERE id = ? AND user_id = ?",
    [searchId, userId],
    (err, result) => {
      if (err) return res.status(500).json({ message: "DB error", error: err.message });
      if (result.affectedRows === 0) return res.status(404).json({ message: "Not found" });
      res.json({ message: "Deleted" });
    }
  );
};

