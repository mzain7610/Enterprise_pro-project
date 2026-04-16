const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const applicationsController = require("../controllers/applicationsController");
const jobsController = require("../controllers/jobsController");
const { getPolicy } = require("../utils/uploadPolicy");
const { auth, optionalAuth } = require("../middleware/auth");
const employerOnly = require("../middleware/employerOnly");

const resumePolicy = getPolicy("resumes");
const jobImagePolicy = getPolicy("jobImages");

const uploadDir = path.join(__dirname, "..", "uploads", "cv");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const jobImageDir = path.join(__dirname, "..", "uploads", "jobs");
if (!fs.existsSync(jobImageDir)) {
  fs.mkdirSync(jobImageDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: resumePolicy.maxSizeMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(resumePolicy.allowedMimeTypes);
    const ext = path.extname(file.originalname || "").toLowerCase();
    const isAllowedExt = resumePolicy.allowedExtensions.includes(ext);
    const isAllowed = allowed.has(file.mimetype) || isAllowedExt;
    cb(isAllowed ? null : new Error(`Only ${resumePolicy.allowedExtensions.join(", ")} files are allowed`), isAllowed);
  }
});

const jobImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, jobImageDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  }
});

const uploadJobImage = multer({
  storage: jobImageStorage,
  limits: { fileSize: jobImagePolicy.maxSizeMB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const mimeAllowed = new Set(jobImagePolicy.allowedMimeTypes).has(file.mimetype);
    const extAllowed = jobImagePolicy.allowedExtensions.includes(ext);
    const isImage = mimeAllowed || extAllowed;
    cb(isImage ? null : new Error(`Only ${jobImagePolicy.allowedExtensions.join(", ")} files are allowed`), isImage);
  }
});

/* Saved searches — must be before /:id */
router.get("/searches", auth, jobsController.getSavedSearches);
router.post("/searches", auth, jobsController.createSavedSearch);
router.delete("/searches/:id", auth, jobsController.deleteSavedSearch);
router.get("/salary-insights", optionalAuth, jobsController.getSalaryInsights);
router.get("/portal-stats", optionalAuth, jobsController.getPortalStats);

/* GET all jobs */
router.get("/", optionalAuth, jobsController.getJobs);
router.get("/:id", optionalAuth, jobsController.getJobById);
router.get("/:id/check-application", auth, applicationsController.checkApplicationStatus);

/* ADD job */
router.post("/", auth, employerOnly, uploadJobImage.single("job_image"), jobsController.addJob);

/* APPLY job */
router.post("/:id/apply", auth, upload.single("cv"), applicationsController.applyJob);

/* REPORT job */
router.post("/:id/report", auth, jobsController.reportJob);

module.exports = router;
