require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const db = require("./config/mysql");
const requestId = require("./middleware/requestId");
const paymentsWebhookRoutes = require("./routes/paymentsWebhook");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const NODE_ENV = process.env.NODE_ENV || "development";
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 300);
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const isLocalDevOrigin = (origin) => {
  try {
    const parsed = new URL(origin);
    return ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(parsed.hostname);
  } catch (err) {
    return false;
  }
};

if (NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(requestId);

// Basic security headers without extra dependencies.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

// Simple in-memory IP rate limiter.
const requestBuckets = new Map();
app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = requestBuckets.get(ip);

  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    requestBuckets.set(ip, { count: 1, start: now });
    return next();
  }

  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ message: "Too many requests, please try again later." });
  }

  return next();
});

app.use(
  cors({
    origin(origin, callback) {
      // Allow server-to-server and same-origin calls with no Origin header.
      if (!origin) return callback(null, true);

      // Allow file:// pages in development (browser sends Origin: null).
      if (origin === "null" && NODE_ENV !== "production") return callback(null, true);

      // In local development, allow frontends served from any localhost port.
      if (NODE_ENV !== "production" && isLocalDevOrigin(origin)) return callback(null, true);

      if (!CORS_ORIGINS.length) {
        if (NODE_ENV !== "production") return callback(null, true);
        return callback(new Error("CORS blocked"));
      }

      return CORS_ORIGINS.includes(origin)
        ? callback(null, true)
        : callback(new Error("CORS blocked"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true
  })
);

// Stripe webhook must receive raw body for signature verification.
app.use("/api/payments", paymentsWebhookRoutes);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const query = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const initializeDatabaseIfNeeded = async () => {
  try {
    const fs = require('fs');
    const dbCheckSql = "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = 'job_portal'";
    
    try {
      const result = await query(dbCheckSql);
      if (result.length > 0) {
        return true;
      }
    } catch (e) {
      console.log("Starting fresh - creating database...");
    }

    const schemaPath = path.join(__dirname, 'sql', 'job_portal_full_schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf-8');
    const fullSQL = `SET FOREIGN_KEY_CHECKS=0;\n${schemaSQL}\nSET FOREIGN_KEY_CHECKS=1;`;
    
    await new Promise((resolve, reject) => {
      db.query(fullSQL, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    
    return true;
  } catch (err) {
    console.error("Database init error (continuing anyway):", err.message);
    return false;
  }
};

const runSchemaChecks = async () => {
  try {
    const requiredUsersColumns = ["role", "phone", "country", "city"];
    const usersColumns = await query(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
    );
    const usersColumnSet = new Set(usersColumns.map((row) => row.COLUMN_NAME));
    const missingUserColumns = requiredUsersColumns.filter((col) => !usersColumnSet.has(col));

    if (missingUserColumns.length) {
      console.warn(
        `⚠️ Missing users columns: ${missingUserColumns.join(", ")}. Run backend/sql/users-profiles.sql to add them.`
      );
    }

    const requiredTables = [
      "job_seeker_profiles",
      "employer_profiles",
      "email_verifications",
      "password_resets",
      "companies",
      "platform_settings"
    ];
    const tableRows = await query(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)",
      [requiredTables]
    );
    const tableSet = new Set(tableRows.map((row) => row.TABLE_NAME));
    const missingTables = requiredTables.filter((name) => !tableSet.has(name));

    if (missingTables.length) {
      console.warn(
        `⚠️ Missing tables: ${missingTables.join(", ")}. Run backend/sql/users-profiles.sql and backend/sql/feature-upgrades.sql.`
      );
    }
  } catch (err) {
    // Silently ignore
  }
};

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Routes
const jobsRoutes = require("./routes/jobs");
const usersRoutes = require("./routes/users");
const adminRoutes = require("./routes/admin");
const applicationsRoutes = require("./routes/applications");
const chatRoutes = require("./routes/chat");
const paymentsRoutes = require("./routes/payments");
const reviewsRoutes = require("./routes/reviews");
const companiesRoutes = require("./routes/companies");
const savedJobsRoutes = require("./routes/savedJobs");
const jobAlertsRoutes = require("./routes/jobAlerts");
const resumesRoutes = require("./routes/resumes");
const messagesRoutes = require("./routes/messages");
const employerRoutes = require("./routes/employer");
const shiftsRoutes = require("./routes/shifts");
const authRoutes = require("./routes/auth");
const notificationsRoutes = require("./routes/notifications");
const recommendationsRoutes = require("./routes/recommendations");
const referralsRoutes = require("./routes/referrals");

app.use("/api/jobs", jobsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/applications", applicationsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/companies", companiesRoutes);
app.use("/api/saved-jobs", savedJobsRoutes);
app.use("/api/job-alerts", jobAlertsRoutes);
app.use("/api/resumes", resumesRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/employer", employerRoutes);
app.use("/api/shifts", shiftsRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/notifications", notificationsRoutes);
app.use("/api/recommendations", recommendationsRoutes);
app.use("/api/referrals", referralsRoutes);

// Initialize database if needed
(async () => {
  try {
    await initializeDatabaseIfNeeded();
    await runSchemaChecks();

    // Check and seed demo data if needed
    try {
      const jobCount = await query("SELECT COUNT(*) as count FROM jobs WHERE is_approved = 1");
      console.log("Job count:", jobCount[0].count);
      
      if (jobCount[0].count === 0) {
        console.log("🔄 Seeding demo data...");

        try {
          // Check if users exist
          const userCount = await query("SELECT COUNT(*) as count FROM users");
          console.log("User count:", userCount[0].count);
          
          if (userCount[0].count === 0) {
            console.log("Creating users...");
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('password123', 10);

            // Insert demo users
            await query("INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())", ['Demo Admin', 'admin@demo.local', hashedPassword, 'admin']);
            await query("INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())", ['Demo Employer', 'employer@demo.local', hashedPassword, 'employer']);
            await query("INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())", ['Demo Job Seeker', 'seeker@demo.local', hashedPassword, 'job_seeker']);
            console.log("✅ Demo users created");
          }

          // Get employer ID
          console.log("Getting employer ID...");
          const employerResult = await query("SELECT id FROM users WHERE role = 'employer' LIMIT 1");
          console.log("Employer result:", employerResult);
          
          if (!employerResult || !employerResult[0]) {
            console.error("No employer found!");
            return;
          }
          
          const employerId = employerResult[0].id;
          console.log("Employer ID:", employerId);

          // Insert demo jobs
          console.log("Inserting jobs...");
          const demoJobs = [
            ['Senior Frontend Developer', 'Remote', 'Full-time', 'IT', 'Build beautiful, performant UIs using React, TypeScript, and modern CSS.', employerId],
            ['Backend Node.js Engineer', 'London', 'Hybrid', 'IT', 'Design and maintain RESTful APIs, optimise SQL queries.', employerId],
            ['DevOps Engineer', 'Manchester', 'Full-time', 'IT', 'Own cloud infrastructure on AWS, write Terraform modules.', employerId]
          ];

          for (const [title, location, jobType, category, description, postedBy] of demoJobs) {
            await query(
              `INSERT INTO jobs (title, location, job_type, category, description, is_approved, is_shift, moderation_status, moderation_score, posted_by, application_deadline, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 1, 0, 'approved_auto', 85, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), NOW(), NOW())`,
              [title, location, jobType, category, description, postedBy]
            );
          }

          console.log("✅ Demo jobs seeded");
        } catch (seederErr) {
          console.error("❌ Seeding error:", seederErr.message);
        }
      }
    } catch (err) {
      console.warn("Demo seeding check failed (continuing anyway):", err.message);
    }
  } catch (initErr) {
    console.error("Initialization error:", initErr.message);
  }
})();

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1 AS ok");
    const jobCount = await query("SELECT COUNT(*) as count FROM jobs WHERE is_approved = 1");
    return res.json({
      status: "ok",
      database: "connected",
      approved_jobs: jobCount[0].count,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({
      status: "error",
      database: "disconnected",
      message: err.message
    });
  }
});

// Temporary seeding endpoint
app.post("/api/admin/seed-demo", async (req, res) => {
  try {
    console.log("🔄 Manual seeding demo data...");

    // Check if users exist
    const userCount = await query("SELECT COUNT(*) as count FROM users");
    if (userCount[0].count === 0) {
      const bcrypt = require('bcryptjs');
      const hashedPassword = await bcrypt.hash('password123', 10);

      // Insert demo users
      await query("INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())", ['Demo Admin', 'admin@demo.local', hashedPassword, 'admin']);
      await query("INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())", ['Demo Employer', 'employer@demo.local', hashedPassword, 'employer']);
      await query("INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())", ['Demo Job Seeker', 'seeker@demo.local', hashedPassword, 'job_seeker']);
      console.log("✅ Demo users created");
    }

    // Check if jobs exist
    const jobCount = await query("SELECT COUNT(*) as count FROM jobs WHERE is_approved = 1");
    if (jobCount[0].count === 0) {
      // Get employer ID
      const employerResult = await query("SELECT id FROM users WHERE role = 'employer' LIMIT 1");
      const employerId = employerResult[0].id;

      // Insert demo jobs
      const demoJobs = [
        ['Senior Frontend Developer', 'Remote', 'Full-time', 'IT', 'Build beautiful, performant UIs using React, TypeScript, and modern CSS.', employerId],
        ['Backend Node.js Engineer', 'London', 'Hybrid', 'IT', 'Design and maintain RESTful APIs, optimise SQL queries.', employerId],
        ['DevOps Engineer', 'Manchester', 'Full-time', 'IT', 'Own cloud infrastructure on AWS, write Terraform modules.', employerId]
      ];

      for (const [title, location, jobType, category, description, postedBy] of demoJobs) {
        await query(
          `INSERT INTO jobs (title, location, job_type, category, description, is_approved, is_shift, moderation_status, moderation_score, posted_by, application_deadline, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, 0, 'approved_auto', 85, ?, DATE_ADD(NOW(), INTERVAL 30 DAY), NOW(), NOW())`,
          [title, location, jobType, category, description, postedBy]
        );
      }

      console.log("✅ Demo jobs seeded");
    }

    res.json({ message: "Demo data seeded successfully" });
  } catch (err) {
    console.error("Seeding failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/favicon.ico", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/favicon.svg"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.use((req, res) => {
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ message: "Not found" });
  }

  res.status(404).sendFile(path.join(__dirname, "../frontend/404.html"));
});

app.use((err, req, res, next) => {
  console.error(`[${req.requestId || "no-request-id"}]`, err);
  if (req.path.startsWith("/api")) {
    return res.status(500).json({
      message: "Server error",
      requestId: req.requestId || null
    });
  }
  res.status(500).sendFile(path.join(__dirname, "../frontend/500.html"));
});

const server = app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});

let shuttingDown = false;

const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`\n[shutdown] Received ${signal}. Closing server...`);
  server.close(() => {
    console.log("[shutdown] HTTP server closed.");
    db.end((dbErr) => {
      if (dbErr) {
        console.error("[shutdown] Error while closing DB pool:", dbErr.message);
        process.exit(1);
      }
      console.log("[shutdown] DB pool closed.");
      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error("[shutdown] Forced exit after timeout.");
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException:", err);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection:", reason);
  shutdown("unhandledRejection");
});
