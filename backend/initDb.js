const fs = require('fs');
const path = require('path');
const mysql = require('mysql2');
require('dotenv').config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true
};

const schemaPath = path.join(__dirname, 'sql', 'job_portal_full_schema.sql');
const sql = fs.readFileSync(schemaPath, 'utf-8');

console.log('🔄 Initializing database...');

const connection = mysql.createConnection(config);

connection.connect((err) => {
  if (err) {
    console.error('❌ Cannot connect to MySQL');
    console.error('   Make sure MySQL is running and credentials in .env are correct');
    console.error('   Error:', err.message);
    process.exit(1);
  }

  console.log('✅ Connected to MySQL');

  // Check if database exists
  connection.query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', ['job_portal'], (err, results) => {
    if (err) {
      console.error('❌ Error checking database:', err.message);
      connection.end();
      process.exit(1);
    }

    if (results.length > 0) {
      console.log('ℹ️  Database job_portal already exists');
      console.log('✅ Skipping database creation (use "npm run reset-db" to recreate)');
      connection.end();
      process.exit(0);
    }

    // Database doesn't exist, create it
    console.log('📦 Creating database and tables...');
    
    // Disable foreign key checks and execute schema
    const fullSql = `SET FOREIGN_KEY_CHECKS=0;\n${sql}\nSET FOREIGN_KEY_CHECKS=1;`;

    connection.query(fullSql, (err) => {
      if (err) {
        console.error('❌ Error creating schema:', err.message);
        connection.end();
        process.exit(1);
      }

      console.log('✅ Database schema created successfully');
      connection.end();
      process.exit(0);
    });
  });
});
