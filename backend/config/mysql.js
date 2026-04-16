const mysql = require("mysql2");

const {
  DB_HOST = "localhost",
  DB_USER = "root",
  DB_PASSWORD = "",
  DB_NAME = "job_portal",
  DB_CONNECTION_LIMIT = 10
} = process.env;

const db = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0
});

db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ MySQL connection error:", err.message);
    return;
  }
  console.log("✅ MySQL connected to job_portal database");
  connection.release();
});

module.exports = db;
