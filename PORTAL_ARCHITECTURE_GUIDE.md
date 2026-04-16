# Job Portal Complete Architecture Guide

## Overview
Your Job Portal is a **comprehensive, multi-role hiring platform** built with Node.js/Express backend and HTML/CSS/JavaScript frontend. It supports three user types: **Job Seekers**, **Employers**, and **Admins** with sophisticated features for job matching, applications, payments, and real-time communication.

---

## 1. DATABASE ARCHITECTURE

### 1.1 Core Tables (job_portal_full_schema.sql)

#### **USERS TABLE** - Central user management
```
- id: Primary key
- name, email, password: Basic auth
- role: ENUM('job_seeker', 'employer', 'admin')
- phone, country, city: Contact info
- verified, is_admin, is_blocked: Status flags
- created_at, updated_at: Timestamps
- email: UNIQUE constraint
```
**Purpose**: All authentication and user identification flows

---

#### **COMPANIES TABLE** - Employer organization
```
- id: Primary key
- owner_user_id: Links to employer user (ONE employer → ONE company)
- name, website, location, size, industry: Company profile
- description, logo_url: Branding
- UNIQUE KEY on owner_user_id (one company per employer)
- Foreign key to users.id
```
**Purpose**: Organize jobs under employer companies

---

#### **JOBS TABLE** - Central job listings
```
Core fields:
- id: Primary key
- title, location, job_type, category: Job identity
- description: Job content
- posted_by: Foreign key to users (employer who posted)
- company_id: Foreign key to companies
- is_approved: Admin approval flag
- application_deadline: When applications close

Premium/Boost features:
- is_premium: Premium listing flag
- reboost_count, last_reboosted_at: Reboost tracking
- moderation_status, moderation_score: Auto-moderation

Job reposting:
- repost_of_job_id: Links to parent job for reposts
- created_at, updated_at: Timestamps

Shift work support:
- is_shift: Boolean for gig/shift jobs
- shift_start, shift_end: DateTime for shift times
- shift_pay_cents, shift_fee_cents, shift_total_cents: Pricing
- shift_currency: Currency code (default 'usd')
- shift_paid, shift_status: Payment tracking

Advanced features:
- image_url: Job thumbnail
- expires_at, renewal_count, last_renewed_at: Job expiration
- salary_min, salary_max: Structured salary
- experience_level: Required experience
- is_remote: Remote work flag
- benefits: Benefits text

Indexes:
- FULLTEXT on (title, description) for search
- INDEX on location, job_type, category, is_approved
```
**Purpose**: The heart of the job marketplace - all job listings

---

#### **APPLICATIONS TABLE** - Job applications from seekers
```
- id: Primary key
- user_id: Foreign key to job seeker
- job_id: Foreign key to job posting
- full_name, email, phone, country: Applicant contact
- cover_letter: Motivation text
- cv_path: Path to uploaded resume
- status: ENUM('pending', 'reviewed', 'accepted', 'rejected') - application state
- pipeline_stage: ENUM('new', 'screening', 'interview', 'offer', 'hired')
- shortlisted: Boolean flag for shortlisting
- score: Numeric ranking
- interview_status, interview_notes: Interview tracking
- created_at: Application timestamp
- UNIQUE KEY on (user_id, job_id) - prevent duplicate applications
- Foreign keys to users, jobs
```
**Purpose**: Track all applicant submissions and their progression

---

#### **APPLICATION MESSAGES TABLE** - Communication in applications
```
- id: Primary key
- application_id: Foreign key to application
- sender_id: Foreign key to user (employer or seeker messaging)
- message: Message content
- created_at: Message timestamp
- Foreign keys to applications, users
```
**Purpose**: Enable back-and-forth communication between employer and applicant

---

#### **SAVED JOBS TABLE** - Bookmarking feature
```
- id: Primary key
- user_id: Foreign key to job seeker
- job_id: Foreign key to job
- created_at: Save timestamp
- UNIQUE KEY on (user_id, job_id) - user can save each job once
- Foreign keys to users, jobs
```
**Purpose**: Allow seekers to save jobs for later review

---

#### **JOB ALERTS TABLE** - Automated matching notifications
```
- id: Primary key
- user_id: Foreign key to job seeker
- keyword: Search term (e.g., "Python Developer")
- location: Preferred location
- category, job_type: Job filters
- frequency: ENUM('daily', 'weekly', 'monthly')
- is_active: Enable/disable alert
- last_sent_at: Last email sent timestamp
- created_at: Alert creation time
- Foreign key to users
```
**Purpose**: Automated job recommendations based on user preferences

---

#### **RESUMES TABLE** - CV storage and parsing
```
- id: Primary key
- user_id: Foreign key to job seeker (UNIQUE)
- file_path: Path to stored resume file
- extracted_text: LONGTEXT - OCR/parsed text from resume
- parsed_at: When resume was parsed
- created_at, updated_at: Timestamps
- Foreign key to users
```
**Purpose**: Store and parse resumes for better job matching

---

#### **JOB SEEKER PROFILES TABLE** - Extended seeker data
```
- id: Primary key
- user_id: Foreign key to users (UNIQUE per seeker)
- photo_url, dob, gender: Personal info
- address, location: Where they live
- linkedin_url, portfolio_url: Professional links
- job_title, skills, experience_years: Professional profile
- current_company, expected_salary: Current status
- preferred_job_type: Job preferences
- resume_url: Backup resume link
- about: Bio/summary
- created_at, updated_at: Timestamps
- Foreign key to users
```
**Purpose**: Build comprehensive job seeker profiles for matching

---

#### **EMPLOYER PROFILES TABLE** - Extended employer verification
```
- id: Primary key
- user_id: Foreign key to users (UNIQUE per employer)
- company_name, company_phone, company_address: Company details
- company_location, website, industry: Company info
- company_size, founded_year, description: Company profile
- registration_number, tax_id: Business verification
- linkedin_url: Company LinkedIn
- created_at, updated_at: Timestamps
- Foreign key to users
```
**Purpose**: Verify and profile employer companies

---

#### **PASSWORD RESETS TABLE** - Forgot password flow
```
- id: Primary key
- user_id: Foreign key to user
- token_hash: CHAR(64) - SHA256 hash of reset token
- expires_at: When token expires
- used_at: When token was used
- created_at: Token creation time
- UNIQUE KEY on token_hash
- INDEX on user_id
- Foreign key to users
```
**Purpose**: Secure password reset token management

---

#### **EMAIL VERIFICATIONS TABLE** - Email confirmation flow
```
- id: Primary key
- user_id: Foreign key to user
- token_hash: CHAR(64) - SHA256 verification token
- expires_at: Token expiration
- used_at: When token was used
- created_at: Token creation time
- UNIQUE KEY, INDEX on user_id
- Foreign key to users
```
**Purpose**: Verify user email addresses during registration

---

#### **PLATFORM SETTINGS TABLE** - Global configuration
```
- setting_key: VARCHAR(100) - PRIMARY KEY
- setting_value: Configuration value
- updated_at: Last modification timestamp
```
**Purpose**: Store admin-configurable system settings

---

#### **SYSTEM ACTIVITY TABLE** - Audit logging
```
Fields vary but typically track:
- User actions (login, logout, job post, application)
- Admin actions (approvals, blocks, settings changes)
- Timestamp and user_id for audit trail
```
**Purpose**: Compliance and debugging user activities

---

### 1.2 Feature-Specific Tables

#### **REVIEWS TABLE** (reviews.sql)
```
- id: Primary key
- name, role, email: Reviewer info
- rating: 1-5 stars
- message: Review text (max 600 chars)
- approved, is_hidden: Moderation flags
- created_at: Review timestamp
```
**Purpose**: Public reviews about the portal/companies

---

#### **COMPANY REVIEWS TABLE** (feature-upgrades.sql)
```
- Extends REVIEWS with:
- company_id: Foreign key to company
- employer_user_id: Foreign key to employer
- job_id: Foreign key to job (optional)
- Better targeting of reviews to specific companies/jobs
```
**Purpose**: Company-specific reviews instead of general reviews

---

#### **REFERRAL SYSTEM** (referrals.sql)
```
REFERRALS TABLE:
- id: Primary key
- referrer_user_id: Who's making the referral
- referred_name, referred_email: Referred person
- referral_code: Unique tracking code (32-char)
- status: ENUM('pending', 'invited', 'hired')
- hired_at: When referred person was hired
- created_at, updated_at: Timestamps
- UNIQUE KEY on (referrer_user_id, referred_email)
- Foreign key to users

REFERRAL_REWARDS TABLE:
- id: Primary key
- referral_id: Foreign key to referrals
- referrer_user_id: Who gets rewarded
- amount_cents: Reward in cents (e.g., 10000 = $100)
- currency: Currency code
- status: 'earned', 'pending', 'paid'
- created_at: Reward timestamp
- UNIQUE KEY on referral_id
```
**Purpose**: Incentivize user growth through referrals with monetary rewards

---

#### **SHIFT/GIG WORK SYSTEM** (shifts.sql)
```
SHIFT_ESCROWS TABLE (Payment protection):
- id: Primary key
- job_id, application_id: Links to shift job and application
- client_id: Employer/client
- worker_id: Job applicant working the shift
- pay_cents, fee_cents, total_cents: Payment breakdown
- currency, payment_method: Payment details
- status: 'awaiting_confirmation' → 'confirmed' → 'released'
- client_confirmed, worker_confirmed: Dual confirmation
- dispute_reason, dispute_note, disputed_at: Dispute tracking
- refunded_at: When money was returned
- release_at, released_at: When payment releases to worker
- created_at: Escrow creation

SHIFT_NOTIFICATIONS TABLE (In-app alerts):
- id: Primary key
- user_id, job_id: Links to user and shift job
- status: 'posted', 'applied', 'accepted', 'paid'
- paid_at: When shift payment was released
- is_read: Whether user has seen notification
- created_at, updated_at: Timestamps
- UNIQUE KEY on (user_id, job_id)
```
**Purpose**: Enable gig/shift work with payment escrow protection

---

#### **SKILLS & ENDORSEMENTS** (skills-endorsements.sql)
```
SKILLS TABLE (Skill dictionary):
- id: Primary key
- name: Skill name (e.g., "Python")
- name_normalized: Lowercase version for deduplication
- created_at: When skill was added
- UNIQUE KEY on name_normalized

USER_SKILLS TABLE (User skill profiles):
- id: Primary key
- user_id, skill_id: Links to user and skill
- source: ENUM('self', 'resume', 'admin')
- created_at: When skill was added
- UNIQUE KEY on (user_id, skill_id)

SKILL_ENDORSEMENTS TABLE (Peer validation):
- id: Primary key
- skill_id, endorsed_user_id, endorsed_by_user_id: Links
- created_at: Endorsement timestamp
- UNIQUE KEY prevents duplicate endorsements
- Allows users to endorse each other's skills (like LinkedIn)
```
**Purpose**: Build credibility through skill endorsements

---

#### **EMAIL NOTIFICATIONS** (email-notifications.sql)
```
USER_NOTIFICATION_PREFERENCES TABLE:
- id: Primary key
- user_id: Foreign key (UNIQUE)
- job_alert_emails, application_update_emails, support_reply_emails: Preferences
- saved_job_update_emails, promotional_emails: More preferences
- email_frequency: 'immediate', 'daily', or 'weekly'
- unsubscribed_from_all: Opt-out flag
- unsubscribe_token: Secret token for unsubscribe links
- created_at, updated_at

EMAIL_NOTIFICATIONS TABLE (Audit trail):
- id: Primary key
- user_id, recipient_email: Who received the email
- email_type: ENUM of 15+ types (job alert, app status, etc.)
- subject, template_name, template_data: Email content
- sent_at: When it was sent
- status: 'sent', 'failed', 'bounced', 'complained'
- retry_count, error_message: Retry logic
- created_at

JOB_MATCH_QUEUE TABLE (Batch processing):
- id: Primary key
- user_id, job_id: Job match event
- job_alert_id: Which alert triggered the match
- match_score: Relevance score
- created_at, processed_at: For batching daily digests

EMAIL_TEMPLATES TABLE:
- id: Primary key
- name: Template identifier (UNIQUE)
- subject_template: Email subject line template
- Template data for customizable emails
```
**Purpose**: Sophisticated email notification system with user preferences

---

#### **INTERVIEW SCHEDULING** (interview-scheduling.sql)
```
INTERVIEWS_SCHEDULED TABLE:
- id: Primary key
- application_id, job_id: Links to application and job
- employer_user_id, candidate_user_id: Interview participants
- scheduled_at: DateTime - Interview date/time
- duration_minutes: Interview length (default 30)
- meeting_type: ENUM('video', 'phone', 'onsite')
- meeting_link: Zoom/Teams URL
- notes: Interview notes
- status: 'scheduled', 'completed', 'cancelled', 'no_show'
- created_at, updated_at
- Indexes on (candidate_user_id, scheduled_at) and (employer_user_id, scheduled_at)
```
**Purpose**: Structured interview scheduling and tracking

---

#### **BACKGROUND CHECKS** (background-checks.sql)
```
BACKGROUND_CHECKS TABLE:
- id: Primary key
- application_id, job_id: Links to application and job
- employer_user_id, candidate_user_id: Check participants
- provider: Provider name (default 'internal')
- package_name: Check type (e.g., 'standard', 'extended')
- status: 'pending' → 'in_progress' → 'clear'/'consider'/'failed'/'cancelled'
- reference_code: Provider's reference ID
- result_summary: Check results (1000 char limit)
- notes: Additional notes
- ordered_at, completed_at: Process timeline
- created_at, updated_at
```
**Purpose**: Manage background check workflow

---

#### **APPLICATION TAGS & SHORTLISTING** (application-tags-shortlist.sql)
```
APPLICATION_TAGS TABLE:
- id: Primary key
- application_id: Foreign key to application
- tag: Tag text (e.g., "follow-up-later")
- created_at
- UNIQUE KEY on (application_id, tag)
- Allows multiple tags per application

ALTER to APPLICATIONS:
- shortlisted: TINYINT(1) - Quick shortlist flag
```
**Purpose**: Organize applications with tags and shortlisting

---

#### **ADVANCED SEARCH** (advanced-search.sql)
```
SAVED_SEARCHES TABLE:
- id: Primary key
- user_id: Foreign key to job seeker
- name: Search name (e.g., "Senior Python roles")
- filters: JSON object with search parameters
- created_at
- Allows users to save complex search queries for reuse

ALTER to JOBS:
- salary_min, salary_max: Structured salary range
- experience_level: Required experience
- is_remote: Remote work flag
- benefits: Benefits description
```
**Purpose**: Enable complex, saveable job searches

---

#### **BULK JOB UPLOAD** (bulk-job-upload.sql)
```
JOB_BULK_UPLOAD_LOGS TABLE:
- id: Primary key
- user_id: Foreign key to employer
- total_rows: Total jobs in upload
- created_count: Successfully created
- failed_count: Failed to create
- created_at: Upload timestamp
```
**Purpose**: Audit trail for bulk job uploads

---

#### **JOB EXPIRATION** (job-expiration.sql)
```
ALTER to JOBS:
- expires_at: DATETIME - When job expires
- renewal_count: How many times renewed
- last_renewed_at: DATETIME - Last renewal date

Auto-initialization:
- expires_at = created_at + 30 days (for existing jobs)
```
**Purpose**: Automatic job expiration and renewal system

---

#### **JOB ACTIONS AUDIT** (job_portal_full_schema.sql - end)
```
JOB_ACTION_LOGS TABLE:
- id: Primary key
- job_id, user_id: Links to job and user
- user_role: ENUM('admin', 'employer') - Who performed action
- action: Action type (e.g., 'approved', 'rejected', 'edited')
- details: JSON details of action
- created_at: Timestamp
- Foreign keys to jobs, users
```
**Purpose**: Audit trail for all job management actions

---

## 2. BACKEND API ROUTES

### 2.1 Route Organization (/backend/routes/)

```
auth.js              → /api/auth              - Login, register, logout, verify email
users.js             → /api/users             - User profiles, settings
jobs.js              → /api/jobs              - Job CRUD, search, filtering
applications.js      → /api/applications      - Apply, view applications, manage pipeline
companies.js         → /api/companies         - Company management
employer.js          → /api/employer          - Employer-specific features
admin.js             → /api/admin             - Admin panel, approve jobs, manage users
chat.js              → /api/chat              - AI chat and messaging
messages.js          → /api/messages          - User-to-user messaging
notifications.js     → /api/notifications     - In-app notifications
jobAlerts.js         → /api/job-alerts        - Job alert management
savedJobs.js         → /api/saved-jobs        - Saved jobs (bookmarks)
resumes.js           → /api/resumes           - Resume upload and management
reviews.js           → /api/reviews           - Platform reviews
payments.js          → /api/payments          - Stripe integration, payment processing
shift*.js            → /api/shifts            - Gig work and shift management
recommendations.js   → /api/recommendations   - Job recommendations
referrals.js         → /api/referrals         - Referral program
paymentsWebhook.js   → /api/payments/webhook  - Stripe webhook handler
```

### 2.2 Key Controllers (/backend/controllers/)

```
authController.js              - JWT tokens, password hashing, email verification
usersController.js             - Profile CRUD, role management
jobsController.js              - Job creation, filtering, FULLTEXT search
applicationsController.js       - Application pipeline, status updates
companiesController.js          - Company CRUD, employer verification
employerController.js           - Employer dashboard, job management
adminController.js              - Moderation, user blocks, job approvals
chatController.js               - AI chat integration
messagesController.js           - User-to-user messages
notificationsController.js      - In-app notification delivery
jobAlertsController.js          - Alert matching and creation
savedJobsController.js          - Bookmark management
resumesController.js            - Resume upload with parsing
reviewsController.js            - Review submission and approval
paymentsController.js           - Stripe payment handling, order creation
recommendationsController.js    - ML-based job matching
referralsController.js          - Referral tracking and rewards
```

### 2.3 Middleware (/backend/middleware/)

```
auth.js              - JWT verification, role extraction
adminOnly.js         - Admin-only endpoint protection
employerOnly.js       - Employer-only endpoint protection
optionalAuth.js       - Optional authentication (public endpoints)
adminAuth.js          - Admin authentication
authRateLimiter.js    - Rate limiting for auth endpoints
validate.js           - Input validation and sanitization
requestId.js          - Request ID tracking for logging
```

---

## 3. FRONTEND ARCHITECTURE

### 3.1 Frontend Pages (/frontend/)

```
index.html              - Homepage with latest jobs
login.html              - Authentication
register.html           - User sign-up
jobs.html               - Browse all jobs with filters
job.html                - Single job detail page
apply.html              - Application form
dashboard.html          - User dashboard (seeker/employer)
profile.html            - User profile editing
admin.html              - Admin control panel
employer.html           - Employer job management
post-jobs.html          - Post new job form
resume.html             - Resume management
shifts.html             - Gig/shift work listings
notifications-settings.html - Notification preferences
company.html            - Company profile
about.html              - About page
ai-chat.html            - AI assistant chat
menu.html               - Navigation menu
404.html                - Not found page
500.html                - Error page
forgot-password.html    - Password reset request
reset-password.html     - Password reset form
verify-email.html       - Email verification
```

### 3.2 Frontend JavaScript Modules (/frontend/js/)

```
navbar.js                  - Navigation, profile dropdown, theme toggle
auth-ui.js                 - Login/register form handling
auth-service.js            - JWT token management
latest-jobs.js             - Homepage job listings
jobs-search.js             - Advanced job search and filtering
job-detail.js              - Single job detail view
application-form.js        - Job application submission
dashboard-seeker.js        - Job seeker dashboard
dashboard-employer.js      - Employer job posting dashboard
profile-edit.js            - User profile updates
admin-panel.js             - Admin moderation UI
company-management.js      - Company profile editing
resume-manager.js          - Resume upload/management
shift-browser.js           - Gig/shift job browsing
notifications-ui.js        - In-app notification display
job-alerts.js              - Alert creation and management
saved-jobs.js              - Bookmarked jobs display
messages.js                - User-to-user chat
support-chat.js            - AI chatbot interface
payment-checkout.js        - Stripe integration UI
company-reviews.js         - Review submission and display
referral-tracking.js       - Referral program tracking
```

### 3.3 Frontend CSS

```
global.css           - Design system, common styles, responsive breakpoints
page-specific.css    - Page-specific styling
responsive.css       - Mobile-first responsive design
animations.css       - Transitions and keyframe animations
theme.css            - Light/dark theme support
```

---

## 4. KEY FEATURES EXPLAINED

### 4.1 User Roles & Access Control

**Job Seeker**
- Browse jobs with advanced filters
- Apply to jobs with resume/cover letter
- Save jobs for later
- Set up job alerts
- View application status in pipeline
- Rate and review companies
- Refer friends for rewards
- Earn money from gig work

**Employer**
- Post and manage job listings
- Premium listing upgrades
- View and filter applications
- Pipeline management (new → interview → offer)
- Interview scheduling
- Background check integration
- Accept/reject candidates
- Bulk job upload
- Company profile verification

**Admin**
- Approve/reject job postings
- User account management and blocking
- Moderation scoring and content review
- Payment transaction management
- Platform settings and configuration
- Audit logs and analytics
- Review management (approve/hide reviews)

### 4.2 Job Lifecycle

```
1. Post Job
   ├─ Employer creates job posting
   ├─ Auto-moderation checks
   ├─ Admin approval needed (or auto-approved based on score)
   └─ Job goes live

2. Job Visible (30 days default)
   ├─ Seekers search and view
   ├─ Seekers save for later
   ├─ Job alerts trigger matches
   └─ Can be rebooted by employer

3. Application Created
   ├─ Seeker applies with resume/cover letter
   ├─ Employer receives notification
   ├─ Application enters pipeline

4. Pipeline Progression
   ├─ new → screening → interview → offer → hired
   ├─ Tags and shortlisting
   ├─ Application messages
   └─ Interview scheduling

5. Job Expiration
   ├─ After 30 days, job expires
   ├─ Can be renewed by employer
   └─ Or rebooted for visibility

6. Payment (if shift work)
   ├─ Escrow holds payment
   ├─ Both parties confirm completion
   ├─ Payment released to worker
   └─ Refund if dispute
```

### 4.3 Email & Notification System

**Automatically triggered emails:**
- Job alert matches (based on saved searches/alerts)
- Application status updates (received, reviewed, accepted, rejected)
- Password reset links
- Email verification links
- Interview invitations
- Support replies
- Referral notifications
- Job expiration warnings

**User controlled:**
- Notification frequency (immediate/daily/weekly)
- Type preferences (job alerts, app updates, promo)
- Unsubscribe option (one-click unsubscribe links)

### 4.4 Payment & Shift Work Flow

```
Employer posts shift job with pay:
├─ Shift pay amount in cents
├─ Employer fee
├─ Total amount to charge

Worker applies and is accepted:
├─ Escrow account created
├─ Money charged via Stripe
├─ Held in escrow during shift

Shift completion:
├─ Both parties confirm completion
├─ Payment released to worker
├─ Escrow closed

Dispute handling:
├─ Either party can dispute
├─ Admin reviews dispute
├─ Refund issued if needed
```

### 4.5 Referral Reward System

```
User A refers User B:
├─ Referral code generated (32-char)
├─ User B invited via email
├─ Tracking created in referrals table

When User B is hired (status = 'hired'):
├─ Reward created for User A
├─ Amount in cents (configurable)
├─ Status: earned → pending → paid
└─ Payment via Stripe

Dashboard shows:
├─ Pending referrals
├─ Hired referrals
├─ Earned rewards
└─ Payment history
```

### 4.6 Advanced Search & Saved Searches

**Search filters:**
- Keyword (FULLTEXT search on job title + description)
- Location
- Job type (full-time, part-time, contract, temporary)
- Category
- Experience level
- Salary range (min/max structured)
- Remote option
- Benefits keywords

**Saved searches:**
- User can save complex filter combinations
- Auto-applied daily to match new jobs
- Triggers email alerts based on frequency preference

---

## 5. SECURITY ARCHITECTURE

### 5.1 Authentication
- JWT tokens in local storage
- Password hashing with bcrypt
- Email verification before account activation
- Password reset with time-limited tokens
- Account blocking for suspicious activity

### 5.2 Authorization
- Role-based access control (RBAC)
- Route middleware to enforce user roles
- Job operations scoped to job owner
- Admin endpoints protected

### 5.3 Data Protection
- Foreign key constraints (referential integrity)
- Unique constraints (prevent duplicates)
- CORS configuration for allowed origins
- Rate limiting on auth endpoints
- SQL injection prevention via parameterized queries

### 5.4 Moderation
- Auto-moderation scoring for job postings
- Admin approval workflow
- Content flagging system
- User blocking capability
- Review approval before public display

---

## 6. DEPLOYMENT & CONFIGURATION

### 6.1 Environment Setup (.env)

```
# Database
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_DATABASE=job_portal

# Server
PORT=3000
NODE_ENV=development

# JWT
JWT_SECRET=your-secret-key

# Stripe (payments)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# Email (if using external SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# CORS
CORS_ORIGINS=http://localhost:3001,http://localhost:3000
```

### 6.2 Database Initialization

```bash
# Option 1: Auto-initialize (built into server startup)
npm start
# Server detects missing database and creates it

# Option 2: Manual initialization
node backend/initDb.js

# Option 3: Individual feature schema files
mysql -u root < backend/sql/users-profiles.sql
mysql -u root < backend/sql/feature-upgrades.sql
mysql -u root < backend/sql/shifts.sql
# etc.
```

### 6.3 Startup Process

```
Backend startup (npm start):
1. Load environment variables (.env)
2. Create Express app with middleware
3. Connect to MySQL
4. Auto-initialize database if needed
5. Run schema checks
6. Mount all API routes
7. Serve static frontend files
8. Listen on PORT (default 3000)

Frontend startup (npm start):
1. Serve HTML pages from /frontend
2. Load CSS and JavaScript modules
3. Initialize service workers
4. Connect to backend API (http://localhost:3000)
5. Serve on PORT (default 3001)
```

---

## 7. DATA FLOW EXAMPLES

### 7.1 Job Search & Application Flow

```
User visits jobs.html
├─ Loads latest-jobs.js
├─ Calls GET /api/jobs (with filters)
├─ Backend queries jobs table with WHERE conditions + FULLTEXT search
├─ Returns matching jobs as JSON
├─ Frontend renders job cards
│
User clicks "View Details"
├─ Loads job.html with job ID
├─ Calls GET /api/jobs/:id
├─ Backend fetches job + company + posted_by info
├─ Shows application button if user is seeker
│
User clicks "Apply"
├─ Modal opens with application form
├─ User uploads resume (POST to /api/resumes)
├─ Writes cover letter
├─ Submits application (POST /api/applications)
├─ Backend creates application record
├─ Adds to applications table
├─ Triggers email notification to employer
├─ Shows success message
│
Employer receives notification
├─ Checks /api/applications endpoint
├─ Views applications table filtered by posted_by
├─ Clicks application to view details
├─ Can shortlist, tag, or move to next pipeline stage
└─ Application messages enable back-and-forth communication
```

### 7.2 Job Alert & Email Match Flow

```
Daily job alert background job runs:
├─ For each user with active job_alerts
│  ├─ Query saved_searches with user_id filter
│  ├─ Run search query against jobs table
│  ├─ Insert matches into job_match_queue
│  └─ Group by user for batching
├─ Check user notifications preferences
│  ├─ If frequency='daily' and pending emails exist
│  ├─ Prepare email with job matches
│  ├─ Call email service (Nodemailer/SendGrid)
│  └─ Insert record in email_notifications table
├─ Track sent_at and status
└─ Retry failed emails based on retry_count

Admin can view:
├─ Email_notifications table for audit trail
├─ Bounce/complaint tracking
├─ User preferences in user_notification_preferences
└─ Email template customization
```

### 7.3 Referral & Reward Flow

```
User A (seeker) wants to refer User B:
├─ Clicks "Share Referral Link"
├─ Generates unique referral_code (e.g., "abc123def456")
├─ Creates record in referrals table
│  ├─ referrer_user_id = A's ID
│  ├─ referred_email = B's email
│  ├─ status = 'pending'
│  └─ referral_code = unique code
├─ Sends email to B with unique link
└─ Link contains referral code

User B clicks link and signs up using referral code:
├─ Registration form receives referral_code
├─ Upon successful signup, updates referral.status = 'invited'
├─ User B's account linked to User A

When User B gets hired:
├─ Admin updates referral.status = 'hired'
├─ Creates record in referral_rewards
│  ├─ referral_id = link to referral
│  ├─ referrer_user_id = A's ID
│  ├─ amount_cents = configured reward
│  └─ status = 'earned'
├─ Charges A's Stripe account or adds to balance
└─ A sees reward in dashboard

User A sees in dashboard:
├─ List of referrals (pending, hired, rewarded)
├─ Earnings from referrals
├─ Payment history
└─ Shareable referral link for future use
```

---

## 8. SCALING CONSIDERATIONS

### Database Indexing Strategy
- FULLTEXT index on jobs (title, description) for search
- INDEX on frequently filtered columns (location, job_type, category, is_approved)
- Foreign key indexes for join operations
- INDEX on user_id for retrieving user-specific records

### Caching Opportunities
- Cache recent jobs list (updates every 5 minutes)
- Cache saved searches results
- Cache user notification preferences
- Cache platform settings

### Background Jobs
- Daily job alert email distribution
- Automatic job expiration after 30 days
- Interview reminder emails 1 day before
- Payment release for completed shifts
- Abandoned application follow-up emails

### Performance Optimizations
- Paginate job listings (20-50 per page)
- Lazy load application messages
- Compress resume PDFs on upload
- CDN for uploaded images
- Database query optimization with proper indexes
- Connection pooling (already configured in mysql2)

---

## 9. EXTENSION POINTS

Your portal is built to be extended:

**New job types:**
- Add is_shift flag for gig work ✅ (already done)
- Add is_temporary flag for temp work
- Add is_seasonal flag for seasonal work

**Employer features:**
- Team accounts (multiple users per company)
- Hiring analytics dashboard
- AI-powered candidate matching
- Video interview integration

**Job seeker features:**
- Skill tests/badges
- Portfolio projects showcase
- Salary negotiation tool
- Job fit scoring

**Monetization:**
- Premium employer features ✅ (already exists: is_premium)
- Advanced resume parsing
- Sponsored job listings
- Subscription plans

---

## 10. DATABASE DIAGRAM (Relationship Overview)

```
users
  ├─ accounts (1:1)
  ├─ employers → employer_profiles (1:1)
  ├─ seekers → job_seeker_profiles (1:1)
  ├─ companies (1:many - as owner)
  ├─ jobs (1:many - as posted_by)
  ├─ applications (1:many - as applicant)
  ├─ messages (1:many - as sender)
  ├─ referrals (1:many - as referrer)
  ├─ job_alerts (1:many)
  ├─ resumes (1:1)
  ├─ background_checks (1:many - as employer_user/candidate)
  ├─ interviews_scheduled (1:many)
  └─ nominations (1:many)

companies
  ├─ users via owner_user_id (1:1)
  ├─ jobs (1:many)
  ├─ company_reviews (1:many)
  └─ background_checks (1:many)

jobs
  ├─ users via posted_by (many:1)
  ├─ companies (many:1)
  ├─ applications (1:many)
  ├─ saved_jobs (1:many)
  ├─ job_alerts (many:many - via matching)
  ├─ shift_escrows (1:many - if is_shift)
  ├─ shift_notifications (1:many - if is_shift)
  ├─ interviews_scheduled (1:many)
  ├─ background_checks (1:many)
  └─ job_action_logs (1:many)

applications
  ├─ users via user_id (many:1)
  ├─ jobs (many:1)
  ├─ application_messages (1:many)
  ├─ application_tags (1:many)
  ├─ shift_escrows (1:1 - if shift work)
  ├─ interviews_scheduled (1:many)
  └─ background_checks (1:many)
```

---

## Summary

Your Job Portal is a **production-ready, feature-rich hiring platform** with:

✅ **Complete user management** (3 roles: seeker, employer, admin)
✅ **Job marketplace** with advanced search and filtering
✅ **Application pipeline** with interview scheduling
✅ **Payment system** for shift/gig work with escrow
✅ **Email & notification system** with user preferences
✅ **Referral rewards** for growth
✅ **Skills endorsements** for credibility
✅ **Background checks** integration
✅ **Admin moderation** and approval workflow
✅ **Comprehensive audit logging** for compliance

It's built on **industry standards**:
- Node.js + Express (proven backend framework)
- MySQL 8+ (ACID transactions, reliability)
- Vanilla JavaScript (no heavy dependencies)
- RESTful API design
- JWT authentication
- Role-based access control
- Database normalization and referential integrity

All database migrations are available in SQL files for extensibility and version control.
