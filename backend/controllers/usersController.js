// GET USER BY ID (for unit test compatibility)
exports.getUserById = (req, res) => {
  const userId = Number(req.params.id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }
  db.query(
    "SELECT id, name, email FROM users WHERE id = ?",
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(404).json({ message: "User not found" });
      res.status(200).json(rows[0]);
    }
  );
};
const db = require("../config/mysql");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { sendMail } = require("../utils/mailer");

const isEmail = (value) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || "");
};

const parseSkills = (value) => {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");

  const normalized = [];
  const seen = new Set();

  for (const item of raw) {
    const clean = String(item || "").trim().replace(/\s+/g, " ");
    if (!clean || clean.length > 50) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
    if (normalized.length >= 30) break;
  }

  return normalized;
};

const normalizeRole = (value) => {
  const role = (value || "").trim().toLowerCase();
  if (!role) return "job_seeker";
  if (["job_seeker", "employer", "admin"].includes(role)) return role;
  return null;
};

const isDigitsOnly = (value) => /^\d+$/.test(String(value || ""));

const ALLOWED_COUNTRY_CITIES = {
  "United Kingdom": ["London", "Manchester", "Birmingham", "Leeds", "Glasgow"],
  "United States": ["New York", "Los Angeles", "Chicago", "Houston", "San Francisco"],
  Canada: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa"],
  Australia: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"],
  India: ["Mumbai", "Delhi", "Bengaluru", "Hyderabad", "Pune"],
  Pakistan: ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad"],
  "United Arab Emirates": ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Al Ain"]
};

const isAllowedCountryCity = (country, city) => {
  const allowedCities = ALLOWED_COUNTRY_CITIES[country];
  if (!allowedCities) return false;
  return allowedCities.includes(city);
};

const ensureEmployerEvidenceColumns = () => {
  const columns = [
    {
      name: "id_document_url",
      ddl: "ALTER TABLE employer_profiles ADD COLUMN id_document_url VARCHAR(500) NULL"
    },
    {
      name: "business_certificate_url",
      ddl: "ALTER TABLE employer_profiles ADD COLUMN business_certificate_url VARCHAR(500) NULL"
    },
    {
      name: "tax_registration_number",
      ddl: "ALTER TABLE employer_profiles ADD COLUMN tax_registration_number VARCHAR(120) NULL"
    },
    {
      name: "authorization_letter_url",
      ddl: "ALTER TABLE employer_profiles ADD COLUMN authorization_letter_url VARCHAR(500) NULL"
    },
    {
      name: "linkedin_profile_url",
      ddl: "ALTER TABLE employer_profiles ADD COLUMN linkedin_profile_url VARCHAR(500) NULL"
    },
    {
      name: "proof_of_address_url",
      ddl: "ALTER TABLE employer_profiles ADD COLUMN proof_of_address_url VARCHAR(500) NULL"
    }
  ];

  columns.forEach((col) => {
    db.query(
      `SELECT 1 AS ok
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employer_profiles' AND COLUMN_NAME = ?
       LIMIT 1`,
      [col.name],
      (checkErr, rows) => {
        if (checkErr || rows?.length) return;
        db.query(col.ddl, () => {});
      }
    );
  });
};

ensureEmployerEvidenceColumns();

const createEmailVerification = (user, cb) => {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  db.query("DELETE FROM email_verifications WHERE user_id = ?", [user.id], (deleteErr) => {
    if (deleteErr) return cb(deleteErr);

    db.query(
      "INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
      [user.id, tokenHash, expiresAt],
      async (insertErr) => {
        if (insertErr) return cb(insertErr);

        const verifyUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/verify-email.html?token=${token}`;

        try {
          const result = await sendMail({
            to: user.email,
            subject: "Verify your JobPortal email",
            text: `Hi ${user.name || ""},\n\nVerify your email: ${verifyUrl}\nThis link expires in 24 hours.\n\nIf you did not create this account, you can ignore this email.`
          });

          if (!result) {
            console.warn("Email delivery unavailable. Verification link:", verifyUrl);
          }
        } catch (mailErr) {
          console.error("Verification email failed:", mailErr);
        }

        return cb(null);
      }
    );
  });
};

/* REGISTER */
exports.registerUser = async (req, res) => {
  const name = (req.body.name || "").trim();
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();
  const phone = (req.body.phone || "").trim();
  const country = (req.body.country || "").trim();
  const city = (req.body.city || "").trim();
  const role = normalizeRole(req.body.role || req.body.accountType);

  const companyName = (req.body.company_name || req.body.companyName || "").trim();
  const companyWebsite = (req.body.company_website || req.body.companyWebsite || "").trim();
  const companyLocation = (req.body.company_location || req.body.companyLocation || "").trim();
  const companyPhone = (req.body.company_phone || req.body.companyPhone || "").trim();
  const companyAddress = (req.body.company_address || req.body.companyAddress || "").trim();
  const idDocumentUrl = (req.body.id_document_url || req.body.idDocumentUrl || "").trim();
  const businessCertificateUrl = (req.body.business_certificate_url || req.body.businessCertificateUrl || "").trim();
  const taxRegistrationNumber = (req.body.tax_registration_number || req.body.taxRegistrationNumber || "").trim();
  const authorizationLetterUrl = (req.body.authorization_letter_url || req.body.authorizationLetterUrl || "").trim();
  const linkedinProfileUrl = (req.body.linkedin_profile_url || req.body.linkedinProfileUrl || "").trim();
  const uploadedIdDoc = req.files?.id_document_file?.[0]
    ? `/uploads/verifications/${req.files.id_document_file[0].filename}`
    : "";
  const uploadedBusinessCert = req.files?.business_certificate_file?.[0]
    ? `/uploads/verifications/${req.files.business_certificate_file[0].filename}`
    : "";
  const uploadedProofOfAddress = req.files?.proof_of_address_file?.[0]
    ? `/uploads/verifications/${req.files.proof_of_address_file[0].filename}`
    : "";
  const uploadedAuthorizationLetter = req.files?.authorization_letter_file?.[0]
    ? `/uploads/verifications/${req.files.authorization_letter_file[0].filename}`
    : "";
  const idDocumentProof = idDocumentUrl || uploadedIdDoc;
  const businessCertificateProof = businessCertificateUrl || uploadedBusinessCert;
  const proofOfAddressProof = (req.body.proof_of_address_url || req.body.proofOfAddressUrl || "").trim() || uploadedProofOfAddress;
  const authorizationLetterProof = authorizationLetterUrl || uploadedAuthorizationLetter;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "All fields required" });
  }

  if (!role) {
    return res.status(400).json({ message: "Invalid role" });
  }

  if (!isEmail(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  if (password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  if (!phone) {
    return res.status(400).json({ message: "Phone is required" });
  }

  if (!isDigitsOnly(phone)) {
    return res.status(400).json({ message: "Phone must contain only digits" });
  }

  if (companyPhone && !isDigitsOnly(companyPhone)) {
    return res.status(400).json({ message: "Company phone must contain only digits" });
  }

  if (role === "job_seeker" && (!country || !city)) {
    return res.status(400).json({ message: "Country and city are required" });
  }

  if (role === "job_seeker" && !isAllowedCountryCity(country, city)) {
    return res.status(400).json({ message: "Please select country and city from the provided dropdown options" });
  }

  if (role === "employer" && (!companyName || !companyLocation)) {
    return res.status(400).json({ message: "Company name and location are required" });
  }

  const isValidHttpUrl = (value) => {
    if (!value) return true;
    return /^https?:\/\/.{4,}/i.test(value);
  };

  if (role === "employer" && !idDocumentProof) {
    return res.status(400).json({ message: "Government ID document URL is required for employer verification" });
  }

  if (role === "employer" && !businessCertificateProof) {
    return res.status(400).json({ message: "Business certificate URL is required for employer verification" });
  }

  if (role === "employer" && !taxRegistrationNumber) {
    return res.status(400).json({ message: "Tax registration number is required for employer verification" });
  }

  if (!isValidHttpUrl(companyWebsite) || !isValidHttpUrl(idDocumentUrl) || !isValidHttpUrl(businessCertificateUrl) || !isValidHttpUrl(authorizationLetterUrl) || !isValidHttpUrl(linkedinProfileUrl)) {
    return res.status(400).json({ message: "Website and verification document links must be valid http(s) URLs" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const sql = `
    INSERT INTO users (name, email, password, phone, role, country, city)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(sql, [name, email, hashedPassword, phone, role, country || null, city || null], (err, result) => {
    if (err) {
      if (err.code === "ER_DUP_ENTRY") {
        return res.status(400).json({ message: "Email already exists" });
      }
      return res.status(500).json({ error: err.message });
    }

    const userId = result.insertId;

    if (role === "employer") {
      db.query(
        `INSERT INTO companies (owner_user_id, name, website, location)
         VALUES (?, ?, ?, ?)`
        ,[
          userId,
          companyName,
          companyWebsite || null,
          companyLocation || null
        ],
        (companyErr) => {
          if (companyErr) {
            return res.status(500).json({ error: companyErr.message });
          }

          db.query(
            `INSERT INTO employer_profiles
             (user_id, company_name, company_phone, company_address, company_location, website,
              id_document_url, business_certificate_url, tax_registration_number, authorization_letter_url, linkedin_profile_url, proof_of_address_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ,[
              userId,
              companyName,
              companyPhone || null,
              companyAddress || null,
              companyLocation || null,
              companyWebsite || null,
              idDocumentProof || null,
              businessCertificateProof || null,
              taxRegistrationNumber || null,
              authorizationLetterProof || null,
              linkedinProfileUrl || null,
              proofOfAddressProof || null
            ],
            (profileErr) => {
              if (profileErr) {
                if (profileErr.code === "ER_BAD_FIELD_ERROR") {
                  return db.query(
                    `INSERT INTO employer_profiles (user_id, company_name, company_phone, company_address, company_location, website)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                      userId,
                      companyName,
                      companyPhone || null,
                      companyAddress || null,
                      companyLocation || null,
                      companyWebsite || null
                    ],
                    (legacyErr) => {
                      if (legacyErr) return res.status(500).json({ error: legacyErr.message });
                      const user = { id: userId, email, name };
                      createEmailVerification(user, (verifyErr) => {
                        if (verifyErr) {
                          return res.status(500).json({ error: verifyErr.message });
                        }
                        return res.status(201).json({ message: "Employer registered. Please verify your email." });
                      });
                    }
                  );
                }
                return res.status(500).json({ error: profileErr.message });
              }

              const user = { id: userId, email, name };
              createEmailVerification(user, (verifyErr) => {
                if (verifyErr) {
                  return res.status(500).json({ error: verifyErr.message });
                }
                res.status(201).json({ message: "Employer registered. Please verify your email." });
              });
            }
          );
        }
      );
      return;
    }

    db.query(
      `INSERT INTO job_seeker_profiles (user_id)
       VALUES (?)`,
      [userId],
      (profileErr) => {
        if (profileErr) {
          return res.status(500).json({ error: profileErr.message });
        }

        db.query(
          "UPDATE users SET verified = 1 WHERE id = ?",
          [userId],
          (verifyUpdateErr) => {
            if (verifyUpdateErr) {
              return res.status(500).json({ error: verifyUpdateErr.message });
            }
            res.status(201).json({ message: "Registration successful." });
          }
        );
      }
    );
  });
};

/* LOGIN + JWT */
exports.loginUser = (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  const password = (req.body.password || "").trim();

  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }

  if (!isEmail(email)) {
    return res.status(400).json({ message: "Invalid email format" });
  }

  const sql = "SELECT * FROM users WHERE email = ?";

  db.query(sql, [email], async (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = results[0];
    if (Number(user.is_blocked) === 1) {
      return res.status(403).json({ message: "Your account is blocked. Contact support." });
    }
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    /* 🔐 CREATE TOKEN */
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) {
      return res.status(500).json({ error: "JWT_SECRET is not configured on server" });
    }
    const token = jwt.sign(
      { id: user.id, is_admin: !!user.is_admin, role: user.role || "job_seeker" },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        verified: user.verified,
        is_admin: user.is_admin,
        role: user.role || "job_seeker",
        phone: user.phone || "",
        country: user.country || "",
        city: user.city || ""
      }
    });
  });
};

/* GET CURRENT USER */
exports.getMe = (req, res) => {
  db.query(
    "SELECT id, name, email, role, phone, country, city, verified, is_admin FROM users WHERE id = ?",
    [req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(404).json({ message: "User not found" });
      res.json(rows[0]);
    }
  );
};

/* UPDATE CURRENT USER */
exports.updateMe = (req, res) => {
  const name = (req.body.name || "").trim();
  const phone = (req.body.phone || "").trim();
  const country = (req.body.country || "").trim();
  const city = (req.body.city || "").trim();
  const photoUrl = (req.body.photo_url || "").trim();

  if (!name) {
    return res.status(400).json({ message: "Name is required" });
  }

  db.query(
    `UPDATE users SET name = ?, phone = ?, country = ?, city = ?, photo_url = ? WHERE id = ?`,
    [name, phone || null, country || null, city || null, photoUrl || null, req.user.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Profile updated" });
    }
  );
};

/* DELETE CURRENT USER */
exports.deleteMe = (req, res) => {
  db.query("DELETE FROM users WHERE id = ?", [req.user.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!result.affectedRows) return res.status(404).json({ message: "User not found" });
    res.json({ message: "Account deleted successfully" });
  });
};

/* GET JOB SEEKER PROFILE */
exports.getJobSeekerProfile = (req, res) => {
  db.query(
    "SELECT * FROM users WHERE id = ?",
    [req.user.id],
    (roleErr, users) => {
      if (roleErr) return res.status(500).json({ error: roleErr.message });
      if (!users.length) return res.status(404).json({ message: "User not found" });
      if (!users[0].is_admin && users[0].role !== "job_seeker") {
        return res.status(403).json({ message: "Job seeker access only" });
      }

      db.query(
        "SELECT * FROM job_seeker_profiles WHERE user_id = ?",
        [req.user.id],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!rows.length) return res.json(null);
          res.json(rows[0]);
        }
      );
    }
  );
};

/* UPDATE JOB SEEKER PROFILE */
exports.updateJobSeekerProfile = (req, res) => {
  const payload = {
    photo_url: (req.body.photo_url || "").trim(),
    dob: (req.body.dob || "").trim(),
    gender: (req.body.gender || "").trim(),
    address: (req.body.address || "").trim(),
    location: (req.body.location || "").trim(),
    linkedin_url: (req.body.linkedin_url || "").trim(),
    portfolio_url: (req.body.portfolio_url || "").trim(),
    job_title: (req.body.job_title || "").trim(),
    skills: (req.body.skills || "").trim(),
    experience_years: req.body.experience_years ? Number(req.body.experience_years) : null,
    current_company: (req.body.current_company || "").trim(),
    expected_salary: (req.body.expected_salary || "").trim(),
    preferred_job_type: (req.body.preferred_job_type || "").trim(),
    resume_url: (req.body.resume_url || "").trim(),
    about: (req.body.about || "").trim()
  };

  db.query(
    "SELECT role, is_admin FROM users WHERE id = ?",
    [req.user.id],
    (roleErr, users) => {
      if (roleErr) return res.status(500).json({ error: roleErr.message });
      if (!users.length) return res.status(404).json({ message: "User not found" });
      if (!users[0].is_admin && users[0].role !== "job_seeker") {
        return res.status(403).json({ message: "Job seeker access only" });
      }

      db.query(
        `INSERT INTO job_seeker_profiles
          (user_id, photo_url, dob, gender, address, location, linkedin_url, portfolio_url,
           job_title, skills, experience_years, current_company, expected_salary, preferred_job_type,
           resume_url, about)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           photo_url = VALUES(photo_url),
           dob = VALUES(dob),
           gender = VALUES(gender),
           address = VALUES(address),
           location = VALUES(location),
           linkedin_url = VALUES(linkedin_url),
           portfolio_url = VALUES(portfolio_url),
           job_title = VALUES(job_title),
           skills = VALUES(skills),
           experience_years = VALUES(experience_years),
           current_company = VALUES(current_company),
           expected_salary = VALUES(expected_salary),
           preferred_job_type = VALUES(preferred_job_type),
           resume_url = VALUES(resume_url),
           about = VALUES(about)`
        ,[
          req.user.id,
          payload.photo_url || null,
          payload.dob || null,
          payload.gender || null,
          payload.address || null,
          payload.location || null,
          payload.linkedin_url || null,
          payload.portfolio_url || null,
          payload.job_title || null,
          payload.skills || null,
          Number.isFinite(payload.experience_years) ? payload.experience_years : null,
          payload.current_company || null,
          payload.expected_salary || null,
          payload.preferred_job_type || null,
          payload.resume_url || null,
          payload.about || null
        ],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Profile updated" });
        }
      );
    }
  );
};

/* GET EMPLOYER PROFILE */
exports.getEmployerProfile = (req, res) => {
  db.query(
    "SELECT role, is_admin FROM users WHERE id = ?",
    [req.user.id],
    (roleErr, users) => {
      if (roleErr) return res.status(500).json({ error: roleErr.message });
      if (!users.length) return res.status(404).json({ message: "User not found" });
      if (!users[0].is_admin && users[0].role !== "employer") {
        return res.status(403).json({ message: "Employer access only" });
      }

      db.query(
        "SELECT * FROM employer_profiles WHERE user_id = ?",
        [req.user.id],
        (err, rows) => {
          if (err) return res.status(500).json({ error: err.message });
          if (!rows.length) return res.json(null);
          res.json(rows[0]);
        }
      );
    }
  );
};

/* UPDATE EMPLOYER PROFILE */
exports.updateEmployerProfile = (req, res) => {
  const payload = {
    company_name: (req.body.company_name || "").trim(),
    company_phone: (req.body.company_phone || "").trim(),
    company_address: (req.body.company_address || "").trim(),
    company_location: (req.body.company_location || "").trim(),
    website: (req.body.website || "").trim(),
    industry: (req.body.industry || "").trim(),
    company_size: (req.body.company_size || "").trim(),
    founded_year: req.body.founded_year ? Number(req.body.founded_year) : null,
    description: (req.body.description || "").trim(),
    registration_number: (req.body.registration_number || "").trim(),
    linkedin_url: (req.body.linkedin_url || "").trim(),
    tax_id: (req.body.tax_id || "").trim()
  };

  if (!payload.company_name) {
    return res.status(400).json({ message: "Company name is required" });
  }

  const foundedYear = Number.isFinite(payload.founded_year) ? payload.founded_year : null;

  db.query(
    "SELECT role, is_admin FROM users WHERE id = ?",
    [req.user.id],
    (roleErr, users) => {
      if (roleErr) return res.status(500).json({ error: roleErr.message });
      if (!users.length) return res.status(404).json({ message: "User not found" });
      if (!users[0].is_admin && users[0].role !== "employer") {
        return res.status(403).json({ message: "Employer access only" });
      }

      db.query(
        `INSERT INTO employer_profiles
          (user_id, company_name, company_phone, company_address, company_location, website, industry, company_size,
           founded_year, description, registration_number, linkedin_url, tax_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           company_name = VALUES(company_name),
           company_phone = VALUES(company_phone),
           company_address = VALUES(company_address),
           company_location = VALUES(company_location),
           website = VALUES(website),
           industry = VALUES(industry),
           company_size = VALUES(company_size),
           founded_year = VALUES(founded_year),
           description = VALUES(description),
           registration_number = VALUES(registration_number),
           linkedin_url = VALUES(linkedin_url),
           tax_id = VALUES(tax_id)`
        ,[
          req.user.id,
          payload.company_name,
          payload.company_phone || null,
          payload.company_address || null,
          payload.company_location || null,
          payload.website || null,
          payload.industry || null,
          payload.company_size || null,
          foundedYear,
          payload.description || null,
          payload.registration_number || null,
          payload.linkedin_url || null,
          payload.tax_id || null
        ],
        (err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({ message: "Employer profile updated" });
        }
      );
    }
  );
};

/* GET SKILLS FOR CURRENT USER */
exports.getMySkills = (req, res) => {
  // Check if skills table exists first
  db.query("SHOW TABLES LIKE 'skills'", (err, tables) => {
    if (err || !tables.length) {
      // Skills tables don't exist yet, return empty array
      return res.json([]);
    }
    
    db.query(
      `SELECT
        us.skill_id,
        s.name,
        COUNT(se.id) AS endorsements_count,
        MAX(CASE WHEN se.endorsed_by_user_id = ? THEN 1 ELSE 0 END) AS endorsed_by_me
       FROM user_skills us
       JOIN skills s ON s.id = us.skill_id
       LEFT JOIN skill_endorsements se
         ON se.skill_id = us.skill_id
        AND se.endorsed_user_id = us.user_id
       WHERE us.user_id = ?
       GROUP BY us.skill_id, s.name
       ORDER BY endorsements_count DESC, s.name ASC`,
      [req.user.id, req.user.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
      }
    );
  });
};

/* GET SKILLS FOR ANY USER */
exports.getUserSkills = (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  db.query(
    `SELECT
      us.skill_id,
      s.name,
      COUNT(se.id) AS endorsements_count,
      MAX(CASE WHEN se.endorsed_by_user_id = ? THEN 1 ELSE 0 END) AS endorsed_by_me
     FROM user_skills us
     JOIN skills s ON s.id = us.skill_id
     LEFT JOIN skill_endorsements se
       ON se.skill_id = us.skill_id
      AND se.endorsed_user_id = us.user_id
     WHERE us.user_id = ?
     GROUP BY us.skill_id, s.name
     ORDER BY endorsements_count DESC, s.name ASC`,
    [req.user.id, userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows || []);
    }
  );
};

/* REPLACE SKILLS FOR CURRENT USER */
exports.updateMySkills = (req, res) => {
  const skills = parseSkills(req.body.skills);
  const userId = req.user.id;

  if (!skills.length) {
    db.query("DELETE FROM user_skills WHERE user_id = ?", [userId], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ error: deleteErr.message });

      db.query("DELETE FROM skill_endorsements WHERE endorsed_user_id = ?", [userId], (endorseDeleteErr) => {
        if (endorseDeleteErr) return res.status(500).json({ error: endorseDeleteErr.message });

        db.query(
          "UPDATE job_seeker_profiles SET skills = NULL WHERE user_id = ?",
          [userId],
          (profileErr) => {
            if (profileErr) return res.status(500).json({ error: profileErr.message });
            return res.json({ message: "Skills updated", skills: [] });
          }
        );
      });
    });
    return;
  }

  const skillRows = skills.map((name) => [name, name.toLowerCase()]);
  const placeholders = skills.map(() => "?").join(",");

  db.query(
    "INSERT INTO skills (name, name_normalized) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name)",
    [skillRows],
    (insertErr) => {
      if (insertErr) return res.status(500).json({ error: insertErr.message });

      db.query(
        `SELECT id, name, name_normalized
         FROM skills
         WHERE name_normalized IN (${placeholders})`,
        skills.map((item) => item.toLowerCase()),
        (fetchErr, skillEntities) => {
          if (fetchErr) return res.status(500).json({ error: fetchErr.message });
          if (!skillEntities.length) return res.status(500).json({ message: "Failed to resolve skills" });

          const selectedIds = skillEntities.map((item) => Number(item.id)).filter((id) => Number.isInteger(id) && id > 0);
          if (!selectedIds.length) return res.status(500).json({ message: "Failed to resolve skill ids" });

          db.query("DELETE FROM user_skills WHERE user_id = ?", [userId], (deleteErr) => {
            if (deleteErr) return res.status(500).json({ error: deleteErr.message });

            const userSkillRows = selectedIds.map((skillId) => [userId, skillId]);
            db.query(
              "INSERT INTO user_skills (user_id, skill_id) VALUES ?",
              [userSkillRows],
              (linkErr) => {
                if (linkErr) return res.status(500).json({ error: linkErr.message });

                db.query(
                  `DELETE FROM skill_endorsements
                   WHERE endorsed_user_id = ?
                     AND skill_id NOT IN (${selectedIds.map(() => "?").join(",")})`,
                  [userId, ...selectedIds],
                  (endorseCleanupErr) => {
                    if (endorseCleanupErr) return res.status(500).json({ error: endorseCleanupErr.message });

                    db.query(
                      "UPDATE job_seeker_profiles SET skills = ? WHERE user_id = ?",
                      [skills.join(", "), userId],
                      (profileErr) => {
                        if (profileErr) return res.status(500).json({ error: profileErr.message });

                        db.query(
                          `SELECT
                            us.skill_id,
                            s.name,
                            COUNT(se.id) AS endorsements_count,
                            MAX(CASE WHEN se.endorsed_by_user_id = ? THEN 1 ELSE 0 END) AS endorsed_by_me
                           FROM user_skills us
                           JOIN skills s ON s.id = us.skill_id
                           LEFT JOIN skill_endorsements se
                             ON se.skill_id = us.skill_id
                            AND se.endorsed_user_id = us.user_id
                           WHERE us.user_id = ?
                           GROUP BY us.skill_id, s.name
                           ORDER BY endorsements_count DESC, s.name ASC`,
                          [userId, userId],
                          (listErr, rows) => {
                            if (listErr) return res.status(500).json({ error: listErr.message });
                            return res.json({ message: "Skills updated", skills: rows || [] });
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          });
        }
      );
    }
  );
};

/* ENDORSE USER SKILL */
exports.endorseUserSkill = (req, res) => {
  const targetUserId = Number(req.params.userId);
  const skillId = Number(req.params.skillId);

  if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !Number.isInteger(skillId) || skillId <= 0) {
    return res.status(400).json({ message: "Invalid user id or skill id" });
  }

  if (targetUserId === req.user.id) {
    return res.status(400).json({ message: "You cannot endorse your own skill" });
  }

  db.query(
    "SELECT id FROM user_skills WHERE user_id = ? AND skill_id = ? LIMIT 1",
    [targetUserId, skillId],
    (existsErr, rows) => {
      if (existsErr) return res.status(500).json({ error: existsErr.message });
      if (!rows.length) return res.status(404).json({ message: "Skill not found for this user" });

      db.query(
        `INSERT IGNORE INTO skill_endorsements (skill_id, endorsed_user_id, endorsed_by_user_id)
         VALUES (?, ?, ?)`,
        [skillId, targetUserId, req.user.id],
        (insertErr, result) => {
          if (insertErr) return res.status(500).json({ error: insertErr.message });
          return res.json({
            message: result.affectedRows ? "Skill endorsed" : "Skill already endorsed",
            endorsed: result.affectedRows > 0
          });
        }
      );
    }
  );
};

/* REMOVE ENDORSEMENT */
exports.removeSkillEndorsement = (req, res) => {
  const targetUserId = Number(req.params.userId);
  const skillId = Number(req.params.skillId);

  if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !Number.isInteger(skillId) || skillId <= 0) {
    return res.status(400).json({ message: "Invalid user id or skill id" });
  }

  db.query(
    `DELETE FROM skill_endorsements
     WHERE skill_id = ? AND endorsed_user_id = ? AND endorsed_by_user_id = ?`,
    [skillId, targetUserId, req.user.id],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ removed: result.affectedRows > 0 });
    }
  );
};

/* GET PUBLIC PROFILE */
exports.getPublicProfile = (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ message: "Invalid user id" });
  }

  db.query(
    `SELECT u.id, u.name, u.role, u.city, u.country, u.photo_url,
            p.job_title, p.skills, p.experience_years, p.current_company,
            p.preferred_job_type, p.location, p.resume_url, p.about, p.linkedin_url, p.portfolio_url
     FROM users u
     LEFT JOIN job_seeker_profiles p ON p.user_id = u.id
     WHERE u.id = ?
     LIMIT 1`,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(404).json({ message: "User not found" });

      const row = rows[0];
      if (row.role !== "job_seeker" && !req.user?.is_admin && Number(req.user?.id) !== userId) {
        return res.status(403).json({ message: "Public profile is available for job seekers only" });
      }

      return res.json(row);
    }
  );
};

/* DELETE CURRENT USER */
exports.deleteMe = (req, res) => {
  db.query(
    "SELECT id, photo_url FROM users WHERE id = ?",
    [req.user.id],
    (findErr, rows) => {
      if (findErr) return res.status(500).json({ error: findErr.message });
      if (!rows.length) return res.status(404).json({ message: "User not found" });

      const user = rows[0];
      db.query(
        "DELETE FROM users WHERE id = ?",
        [req.user.id],
        (deleteErr, result) => {
          if (deleteErr) return res.status(500).json({ error: deleteErr.message });
          if (result.affectedRows === 0) return res.status(404).json({ message: "User not found" });

          if (user.photo_url && user.photo_url.startsWith("/uploads/photos/")) {
            const photoPath = require("path").join(__dirname, "..", user.photo_url.replace(/^\//, ""));
            require("fs").unlink(photoPath, () => {});
          }

          res.json({ message: "Account deleted successfully" });
        }
      );
    }
  );
};

/* REQUEST PASSWORD RESET */
exports.forgotPassword = (req, res) => {
  const email = (req.body.email || "").trim().toLowerCase();
  if (!email || !isEmail(email)) {
    return res.status(400).json({ message: "Valid email is required" });
  }

  db.query("SELECT id, email, name FROM users WHERE email = ?", [email], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!rows.length) {
      return res.json({ message: "If that email exists, a reset link was sent." });
    }

    const user = rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    db.query("DELETE FROM password_resets WHERE user_id = ?", [user.id], (deleteErr) => {
      if (deleteErr) return res.status(500).json({ error: deleteErr.message });

      db.query(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)",
        [user.id, tokenHash, expiresAt],
        async (insertErr) => {
          if (insertErr) return res.status(500).json({ error: insertErr.message });

          const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/reset-password.html?token=${token}`;

          try {
            const result = await sendMail({
              to: user.email,
              subject: "Reset your JobPortal password",
              text: `Hi ${user.name || ""},\n\nReset your password: ${resetUrl}\nThis link expires in 30 minutes.\n\nIf you did not request this, you can ignore this email.`
            });

            if (!result) {
              console.warn("Email delivery unavailable. Password reset link:", resetUrl);
            }
          } catch (mailErr) {
            console.error("Password reset email failed:", mailErr);
          }

          return res.json({ message: "If that email exists, a reset link was sent." });
        }
      );
    });
  });
};

/* RESET PASSWORD */
exports.resetPassword = async (req, res) => {
  const token = (req.body.token || "").trim();
  const password = (req.body.password || "").trim();

  if (!token) {
    return res.status(400).json({ message: "Reset token is required" });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ message: "Password must be at least 6 characters" });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  db.query(
    "SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?",
    [tokenHash],
    async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(400).json({ message: "Invalid or expired reset token" });

      const reset = rows[0];
      if (reset.used_at) {
        return res.status(400).json({ message: "Reset token already used" });
      }

      if (reset.expires_at && new Date(reset.expires_at) < new Date()) {
        return res.status(400).json({ message: "Reset token expired" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      db.query(
        "UPDATE users SET password = ? WHERE id = ?",
        [hashedPassword, reset.user_id],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: updateErr.message });

          db.query(
            "UPDATE password_resets SET used_at = NOW() WHERE id = ?",
            [reset.id],
            (markErr) => {
              if (markErr) return res.status(500).json({ error: markErr.message });
              res.json({ message: "Password updated successfully" });
            }
          );
        }
      );
    }
  );
};

/* VERIFY USER */
exports.verifyUser = (req, res) => {
  const { userId } = req.params;

  const sql = "UPDATE users SET verified = 1 WHERE id = ?";

  db.query(sql, [userId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "User verified successfully" });
  });
};

/* VERIFY EMAIL TOKEN */
exports.verifyEmail = (req, res) => {
  const token = (req.body.token || req.query.token || "").trim();
  if (!token) {
    return res.status(400).json({ message: "Verification token is required" });
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  db.query(
    "SELECT id, user_id, expires_at, used_at FROM email_verifications WHERE token_hash = ?",
    [tokenHash],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!rows.length) return res.status(400).json({ message: "Invalid or expired verification link" });

      const record = rows[0];
      if (record.used_at) {
        return res.status(400).json({ message: "Verification link already used" });
      }

      if (new Date(record.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ message: "Verification link expired" });
      }

      db.query(
        "UPDATE users SET verified = 1 WHERE id = ?",
        [record.user_id],
        (updateErr) => {
          if (updateErr) return res.status(500).json({ error: updateErr.message });

          db.query(
            "UPDATE email_verifications SET used_at = NOW() WHERE id = ?",
            [record.id],
            (markErr) => {
              if (markErr) return res.status(500).json({ error: markErr.message });
              res.json({ message: "Email verified successfully" });
            }
          );
        }
      );
    }
  );
};
