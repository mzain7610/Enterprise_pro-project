require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function checkAndSeedJobs() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: 'job_portal'
    });

    // Check if users exist
    const [userRows] = await conn.execute('SELECT id, role FROM users LIMIT 5');
    console.log('Users in database:', userRows.length);

    if (userRows.length === 0) {
      console.log('No users found. Creating demo users first...');

      // Insert demo users
      const users = [
        { name: 'Demo Admin', email: 'admin@demo.local', password: 'password123', role: 'admin' },
        { name: 'Demo Employer', email: 'employer@demo.local', password: 'password123', role: 'employer' },
        { name: 'Demo Job Seeker', email: 'seeker@demo.local', password: 'password123', role: 'job_seeker' }
      ];

      for (const user of users) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        await conn.execute(
          'INSERT INTO users (name, email, password, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
          [user.name, user.email, hashedPassword, user.role]
        );
      }

      console.log('Demo users created');
    }

    const [jobRows] = await conn.execute('SELECT COUNT(*) as count FROM jobs WHERE is_approved = 1');
    console.log('Approved jobs in database:', jobRows[0].count);

    if (jobRows[0].count === 0) {
      console.log('No approved jobs found. Inserting demo jobs...');

      // Get employer user ID
      const [employerRows] = await conn.execute('SELECT id FROM users WHERE role = ? LIMIT 1', ['employer']);
      const employerId = employerRows.length > 0 ? employerRows[0].id : 2;

      // Insert demo jobs
      const demoJobs = [
        {
          title: 'Senior Frontend Developer',
          location: 'Remote',
          job_type: 'Full-time',
          category: 'IT',
          description: 'Build beautiful, performant UIs using React, TypeScript, and modern CSS.',
          is_approved: 1,
          is_shift: 0,
          moderation_status: 'approved_auto',
          moderation_score: 85,
          posted_by: employerId,
          application_deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        },
        {
          title: 'Backend Node.js Engineer',
          location: 'London',
          job_type: 'Hybrid',
          category: 'IT',
          description: 'Design and maintain RESTful APIs, optimise SQL queries.',
          is_approved: 1,
          is_shift: 0,
          moderation_status: 'approved_auto',
          moderation_score: 85,
          posted_by: employerId,
          application_deadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000)
        },
        {
          title: 'DevOps Engineer',
          location: 'Manchester',
          job_type: 'Full-time',
          category: 'IT',
          description: 'Own cloud infrastructure on AWS, write Terraform modules.',
          is_approved: 1,
          is_shift: 0,
          moderation_status: 'approved_auto',
          moderation_score: 85,
          posted_by: employerId,
          application_deadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000)
        }
      ];

      for (const job of demoJobs) {
        await conn.execute(
          `INSERT INTO jobs (title, location, job_type, category, description, is_approved, is_shift, moderation_status, moderation_score, posted_by, application_deadline, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            job.title,
            job.location,
            job.job_type,
            job.category,
            job.description,
            job.is_approved,
            job.is_shift,
            job.moderation_status,
            job.moderation_score,
            job.posted_by,
            job.application_deadline
          ]
        );
      }

      console.log('Demo jobs inserted successfully');
    } else {
      console.log('Jobs already exist in database');
    }

    conn.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkAndSeedJobs();