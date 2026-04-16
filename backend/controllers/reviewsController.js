const db = require("../config/mysql");

const ensureCompanyReviewColumn = (columnName, ddl) => {
  db.query(
    `SELECT 1 AS ok
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_reviews' AND COLUMN_NAME = ?
     LIMIT 1`,
    [columnName],
    (checkErr, rows) => {
      if (checkErr || rows?.length) return;
      db.query(ddl, (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_FIELDNAME") {
          console.warn("company_reviews column bootstrap failed:", alterErr.message);
        }
      });
    }
  );
};

const ensureCompanyReviewIndex = (indexName, ddl) => {
  db.query(
    `SELECT 1 AS ok
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_reviews' AND INDEX_NAME = ?
     LIMIT 1`,
    [indexName],
    (checkErr, rows) => {
      if (checkErr || rows?.length) return;
      db.query(ddl, (alterErr) => {
        if (alterErr && alterErr.code !== "ER_DUP_KEYNAME") {
          console.warn("company_reviews index bootstrap failed:", alterErr.message);
        }
      });
    }
  );
};

const ensureCompanyReviewsSchema = () => {
  db.query(
    `CREATE TABLE IF NOT EXISTS company_reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      user_id INT NULL,
      reviewer_name VARCHAR(120),
      reviewer_role VARCHAR(120) NULL,
      job_id INT NULL,
      rating TINYINT NOT NULL,
      message TEXT,
      approved TINYINT(1) DEFAULT 0,
      is_hidden TINYINT(1) DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_company_reviews_company (company_id),
      INDEX idx_company_reviews_status (approved, is_hidden)
    )`,
    (err) => {
      if (err) {
        console.warn("company_reviews bootstrap failed:", err.message);
        return;
      }
      ensureCompanyReviewColumn("user_id", "ALTER TABLE company_reviews ADD COLUMN user_id INT NULL");
      ensureCompanyReviewColumn("reviewer_name", "ALTER TABLE company_reviews ADD COLUMN reviewer_name VARCHAR(120) NULL");
      ensureCompanyReviewColumn("reviewer_role", "ALTER TABLE company_reviews ADD COLUMN reviewer_role VARCHAR(120) NULL");
      ensureCompanyReviewColumn("approved", "ALTER TABLE company_reviews ADD COLUMN approved TINYINT(1) DEFAULT 0");
      ensureCompanyReviewColumn("is_hidden", "ALTER TABLE company_reviews ADD COLUMN is_hidden TINYINT(1) DEFAULT 0");
      ensureCompanyReviewColumn("job_id", "ALTER TABLE company_reviews ADD COLUMN job_id INT NULL");
      ensureCompanyReviewIndex("idx_company_reviews_company", "ALTER TABLE company_reviews ADD INDEX idx_company_reviews_company (company_id)");
      ensureCompanyReviewIndex("idx_company_reviews_status", "ALTER TABLE company_reviews ADD INDEX idx_company_reviews_status (approved, is_hidden)");
    }
  );

  db.query(
    `SELECT DATA_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'company_reviews' AND COLUMN_NAME = 'reviewer_role'
     LIMIT 1`,
    (typeErr, typeRows) => {
      if (typeErr || !typeRows?.length) return;
      const dataType = String(typeRows[0].DATA_TYPE || "").toLowerCase();
      if (dataType === "varchar") return;
      db.query("ALTER TABLE company_reviews MODIFY COLUMN reviewer_role VARCHAR(120) NULL", (modifyErr) => {
        if (modifyErr && modifyErr.code !== "ER_DUP_FIELDNAME") {
          console.warn("company_reviews reviewer_role normalize failed:", modifyErr.message);
        }
      });
    }
  );
};

ensureCompanyReviewsSchema();

const isEmail = (value) => {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const ensureCompanyReviewsTable = () => {
  return new Promise((resolve, reject) => {
    const sql = `
      CREATE TABLE IF NOT EXISTS company_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company_id INT NOT NULL,
        employer_user_id INT NULL,
        job_id INT NULL,
        reviewer_name VARCHAR(120) NOT NULL,
        reviewer_role VARCHAR(120) NOT NULL,
        reviewer_email VARCHAR(255) NULL,
        rating TINYINT NOT NULL,
        message VARCHAR(600) NOT NULL,
        approved TINYINT NOT NULL DEFAULT 0,
        is_hidden TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_company_reviews_company (company_id),
        INDEX idx_company_reviews_employer (employer_user_id),
        INDEX idx_company_reviews_job (job_id),
        CONSTRAINT fk_company_reviews_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
        CONSTRAINT fk_company_reviews_employer FOREIGN KEY (employer_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_company_reviews_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;

    db.query(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
};

exports.getReviews = (req, res) => {
  const limit = Math.min(Number(req.query.limit || 12), 50);

  db.query(
    "SELECT name, role, rating, message, created_at FROM reviews WHERE approved = 1 AND is_hidden = 0 ORDER BY created_at DESC LIMIT ?",
    [limit],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to load reviews" });
      }
      res.json(rows);
    }
  );
};

exports.createReview = (req, res) => {
  const name = (req.body.name || "").trim();
  const role = (req.body.role || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const message = (req.body.message || "").trim();
  const rating = Number(req.body.rating || 0);

  if (!name || !role || !message || !rating) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (!isEmail(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  if (name.length > 120 || role.length > 120) {
    return res.status(400).json({ message: "Name or role too long" });
  }

  if (message.length > 600) {
    return res.status(400).json({ message: "Message too long" });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Rating must be 1-5" });
  }

  db.query(
    "INSERT INTO reviews (name, role, email, rating, message, approved) VALUES (?, ?, ?, ?, ?, ?)",
    [name, role, email || null, rating, message, 0],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to save review" });
      }
      res.status(201).json({ message: "Review submitted for approval" });
    }
  );
};

exports.getCompanyReviews = async (req, res) => {
  const companyId = Number(req.params.companyId);
  const limit = Math.min(Number(req.query.limit || 12), 50);

  if (!companyId) {
    return res.status(400).json({ message: "Invalid company id" });
  }

  try {
    await ensureCompanyReviewsTable();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to initialize company reviews" });
  }

  db.query(
    `SELECT reviewer_name AS name,
            reviewer_role AS role,
            rating,
            message,
            created_at,
            job_id,
            CASE
              WHEN reviewer_email IS NOT NULL AND job_id IS NOT NULL THEN 1
              ELSE 0
            END AS verified_review
     FROM company_reviews
     WHERE approved = 1 AND is_hidden = 0 AND company_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [companyId, limit],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to load company reviews" });
      }
      res.json(rows);
    }
  );
};

exports.createCompanyReview = async (req, res) => {
  const companyId = Number(req.params.companyId);
  const role = (req.body.role || "Candidate").trim();
  const message = (req.body.message || "").trim();
  const rating = Number(req.body.rating || 0);
  const employerUserId = req.body.employer_user_id ? Number(req.body.employer_user_id) : null;
  const jobId = req.body.job_id ? Number(req.body.job_id) : null;

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Login required to post a company review" });
  }

  const reviewerUserId = Number(req.user.id);

  if (!companyId) {
    return res.status(400).json({ message: "Invalid company id" });
  }

  if (!role || !message || !rating) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (role.length > 120) {
    return res.status(400).json({ message: "Role is too long" });
  }

  if (message.length > 600) {
    return res.status(400).json({ message: "Message too long" });
  }

  if (rating < 1 || rating > 5) {
    return res.status(400).json({ message: "Rating must be 1-5" });
  }

  try {
    await ensureCompanyReviewsTable();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Failed to initialize company reviews" });
  }

  const reviewer = await new Promise((resolve, reject) => {
    db.query(
      "SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1",
      [reviewerUserId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows && rows[0] ? rows[0] : null);
      }
    );
  }).catch((err) => {
    console.error(err);
    return null;
  });

  if (!reviewer) {
    return res.status(404).json({ message: "Reviewer account not found" });
  }

  const eligibilityRows = await new Promise((resolve, reject) => {
    const eligibilitySql = `
      SELECT a.id AS application_id,
             a.job_id,
             a.status,
             a.pipeline_stage,
             a.interview_status,
             j.company_id,
             j.posted_by
      FROM applications a
      JOIN jobs j ON j.id = a.job_id
      WHERE a.user_id = ?
        AND j.company_id = ?
        AND (
          LOWER(COALESCE(a.status, '')) IN ('accepted', 'hired', 'completed')
          OR LOWER(COALESCE(a.pipeline_stage, '')) = 'hired'
          OR LOWER(COALESCE(a.interview_status, '')) IN ('completed', 'offered')
        )
      ORDER BY a.id DESC
      LIMIT 20
    `;

    db.query(eligibilitySql, [reviewerUserId, companyId], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  }).catch((err) => {
    console.error(err);
    return null;
  });

  if (!eligibilityRows) {
    return res.status(500).json({ message: "Failed to validate review eligibility" });
  }

  if (!eligibilityRows.length) {
    return res.status(403).json({
      message: "Only candidates with completed/hired activity for this company can post reviews"
    });
  }

  let matchedEligibility = null;
  if (Number.isFinite(jobId)) {
    matchedEligibility = eligibilityRows.find((row) => Number(row.job_id) === Number(jobId)) || null;
    if (!matchedEligibility) {
      return res.status(403).json({
        message: "You are not eligible to review this job under the selected company"
      });
    }
  } else {
    matchedEligibility = eligibilityRows[0];
  }

  const finalEmployerUserId = Number.isFinite(employerUserId)
    ? employerUserId
    : (matchedEligibility && Number(matchedEligibility.posted_by)) || null;
  const finalJobId = (matchedEligibility && Number(matchedEligibility.job_id)) || null;

  const duplicateRows = await new Promise((resolve, reject) => {
    db.query(
      `SELECT id
       FROM company_reviews
       WHERE company_id = ? AND reviewer_email = ? AND ((job_id IS NULL AND ? IS NULL) OR job_id = ?)
       LIMIT 1`,
      [companyId, String(reviewer.email || '').toLowerCase() || null, finalJobId, finalJobId],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      }
    );
  }).catch((err) => {
    console.error(err);
    return null;
  });

  if (!duplicateRows) {
    return res.status(500).json({ message: "Failed to validate duplicate reviews" });
  }

  if (duplicateRows.length) {
    return res.status(409).json({ message: "You have already posted a review for this company/job" });
  }

  db.query(
    `INSERT INTO company_reviews
      (company_id, employer_user_id, job_id, reviewer_name, reviewer_role, reviewer_email, rating, message, approved)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      finalEmployerUserId,
      finalJobId,
      String(reviewer.name || "Candidate").slice(0, 120),
      role,
      String(reviewer.email || "").toLowerCase() || null,
      rating,
      message,
      0
    ],
    (err) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Failed to save company review" });
      }
      res.status(201).json({ message: "Review submitted for approval" });
    }
  );
};
