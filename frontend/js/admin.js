(() => {
  const adminToken = localStorage.getItem("token");
  const rawUser = localStorage.getItem("user");
  let adminUser = null;
  if (rawUser) {
    try {
      adminUser = JSON.parse(rawUser);
    } catch (err) {
      console.error("Invalid JSON in localStorage.user", err);
      localStorage.removeItem("user");
    }
  }

  if (!adminToken || !adminUser || !adminUser.is_admin) {
    showError("Access denied");
    window.location.href = "index.html";
    return;
  }

  const adminAuthFetch = window.authFetch
    ? window.authFetch
    : (url, options = {}) => {
        return fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${adminToken}`
          }
        });
      };

  let adminJobsCache = [];
  let adminUsersCache = [];
  let editJobId = null;
  let reviewStatusFilter = "pending";
  let reviewSourceFilter = "portal";
  let reviewVerifiedFilter = "all";
  let grantHistoryFilter = "all";

  const adminJobForm = document.getElementById("adminJobForm");
  const adminJobTitle = document.getElementById("adminJobTitle");
  const adminJobLocation = document.getElementById("adminJobLocation");
  const adminJobType = document.getElementById("adminJobType");
  const adminJobCategory = document.getElementById("adminJobCategory");
  const adminJobDescription = document.getElementById("adminJobDescription");
  const adminJobPremium = document.getElementById("adminJobPremium");
  const adminJobSubmit = document.getElementById("adminJobSubmit");
  const adminJobCancel = document.getElementById("adminJobCancel");
  const autoApproveToggle = document.getElementById("autoApproveToggle");
  const autoApproveMeta = document.getElementById("autoApproveMeta");
  const saveAutoApproveBtn = document.getElementById("saveAutoApproveBtn");

  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get("payment");
  const sessionId = params.get("session_id");
  const mode = params.get("mode");
  const paidJobId = params.get("jobId");

  if (paymentStatus === "success" && mode === "upgrade" && sessionId && paidJobId) {
    adminAuthFetch(`${API}/payments/confirm`, {
      method: "POST",
      body: JSON.stringify({
        sessionId,
        mode: "upgrade",
        jobId: paidJobId
      })
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Payment confirmation failed");
        return;
      }
      showError("Job upgraded to premium Γ£à");
      window.history.replaceState({}, document.title, "admin.html");
      loadJobs();
    });
  }

  function loadJobs() {
    adminAuthFetch(`${API}/admin/jobs`)
      .then(res => res.json())
      .then(jobs => {
        adminJobsCache = jobs;
        const jobsContainer = document.getElementById("jobs");
        if (!jobsContainer) {
          console.error("jobsContainer element not found");
          return;
        }

        if (!jobs || !Array.isArray(jobs) || jobs.length === 0) {
          jobsContainer.innerHTML = '<p class="empty-state">No jobs found.</p>';
          return;
        }

        jobsContainer.innerHTML = "";

        // Separate shift jobs from regular jobs; shift jobs are shown in the Shifts section
        const regularJobs = jobs.filter(j => !j.is_shift);
        const shiftJobs = jobs.filter(j => j.is_shift);

        if (!regularJobs.length) {
          jobsContainer.innerHTML = '<p class="empty-state">No regular jobs found.</p>';
        }

        // Render shift jobs in the shifts section
        renderShiftJobs(shiftJobs);

        regularJobs.forEach(job => {
          const shiftBadge = "";
          const shiftPaid = "";
          const shiftAction = "";
          const moderationScore = Number.isFinite(Number(job.moderation_score))
            ? Number(job.moderation_score)
            : null;
          const moderationStatus = (job.moderation_status || "pending_manual_review").replace(/_/g, " ");
          const moderationReason = (job.moderation_reason || "No moderation notes").trim();
          const aiFlag = moderationReason.toLowerCase().includes("ai") ? "≡ƒñû" : "";
          const moderationMeta = `
            <div class="p-muted" style="margin-top:6px;">
              Moderation: <strong>${esc(moderationStatus)}</strong>
              ${moderationScore !== null ? `ΓÇó Score: <strong>${moderationScore}</strong>` : ""}
              ${aiFlag}
            </div>
            <div class="p-muted" style="margin-top:4px;">Reason: ${esc(moderationReason)}</div>
          `;

          jobsContainer.innerHTML += `
            <article class="job-card admin-record">
              <div class="admin-record-head">
                <div>
                  <h4>${esc(job.title)}</h4>
                  <p class="p-muted">${esc(job.location || "No location")} \u2022 ${esc(job.job_type || job.jobType || "General")} \u2022 ${esc(job.category || "General")}</p>
                </div>
                <div class="admin-record-badges">
                  ${job.is_premium ? '<span class="tag-pill bg-amber-100 text-amber-700">Premium</span>' : ""}
                  ${shiftBadge ? '<span class="tag-pill bg-cyan-100 text-cyan-700">Shift</span>' : ""}
                  ${shiftPaid ? '<span class="tag-pill bg-green-100 text-green-700">Paid</span>' : ""}
                  <span class="tag-pill ${job.is_approved ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}">${job.is_approved ? "Approved" : "Pending"}</span>
                </div>
              </div>
              ${moderationMeta}
              <div class="admin-record-actions">
                <button class="btn btn-outline" onclick="editJob('${job.id}')">Edit</button>
                <button class="btn btn-outline" onclick="approveJob('${job.id}')">Approve</button>
                <button class="btn btn-outline" onclick="makePremium('${job.id}')">Premium</button>
                <button class="btn btn-outline" onclick="viewJobApplications('${job.id}')">Applications</button>
                <button class="btn btn-outline" onclick="deleteJob('${job.id}')">Delete</button>
                ${shiftAction}
              </div>
            </article>
          `;
        });
      })
      .catch(err => {
        console.error("Error loading jobs:", err);
        const jobsContainer = document.getElementById("jobs");
        if (jobsContainer) {
          jobsContainer.innerHTML = `<p class="empty-state" style="color: #ef4444;">Error loading jobs: ${err.message}</p>`;
        }
      });
  }

  function loadApplications() {
    adminAuthFetch(`${API}/applications/admin`)
      .then(res => res.json())
      .then(apps => {
        renderApplications(apps, "Applications");
      })
      .catch(err => {
        console.error("Error loading applications:", err);
        const container = document.getElementById("applications");
        if (container) {
          container.innerHTML = `<p class="empty-state" style="color: #ef4444;">Error loading applications: ${err.message}</p>`;
        }
      });
  }

  function loadUsers() {
    adminAuthFetch(`${API}/admin/users`)
      .then(res => res.json())
      .then(users => {
        adminUsersCache = Array.isArray(users) ? users : [];
        const usersContainer = document.getElementById("users");
        if (!usersContainer) return;

        if (!adminUsersCache.length) {
          usersContainer.innerHTML = "<p class=\"empty-state\">No users found.</p>";
          return;
        }

        usersContainer.innerHTML = "";
        adminUsersCache.forEach(user => {
          const role = user.role || (user.is_admin ? "admin" : "job_seeker");
          const created = user.created_at ? new Date(user.created_at).toLocaleDateString() : "";
          const blockedBadge = user.is_blocked
            ? '<span class="tag-pill bg-red-100 text-red-700">Blocked</span>'
            : '<span class="tag-pill bg-green-100 text-green-700">Active</span>';
          const adminBadge = user.is_admin
            ? '<span class="tag-pill bg-indigo-100 text-indigo-700">Admin</span>'
            : "";

          usersContainer.innerHTML += `
            <article class="job-card admin-record">
              <div class="admin-record-head">
                <div>
                  <h4>${esc(user.name || "Unnamed user")}</h4>
                  <p class="p-muted">${esc(user.email || "No email")}</p>
                  <p class="p-muted">Role: ${role}${created ? ` ΓÇó Joined: ${created}` : ""}</p>
                </div>
                <div class="admin-record-badges">
                  ${blockedBadge}
                  ${adminBadge}
                </div>
              </div>
              <div class="admin-record-actions">
                <button class="btn btn-outline" onclick="toggleUserBlock(${user.id}, ${user.is_blocked ? 0 : 1})">
                  ${user.is_blocked ? "Unblock" : "Block"}
                </button>
                <button class="btn btn-outline" onclick="toggleUserVerify(${user.id}, ${user.verified ? 0 : 1})">
                  ${user.verified ? "Unverify" : "Verify"}
                </button>
                <button class="btn btn-outline" onclick="deleteUserAccount(${user.id})">Delete</button>
                ${user.is_admin ? "" : `<button class=\"btn btn-outline\" onclick=\"requestAdminGrant(${user.id})\">Request admin grant</button>`}
                ${user.is_admin ? "" : `<button class=\"btn btn-primary\" onclick=\"promoteUserToAdmin(${user.id})\">Make admin</button>`}
              </div>
            </article>
          `;
        });
      })
      .catch(err => {
        console.error("Error loading users:", err);
        const usersContainer = document.getElementById("users");
        if (usersContainer) {
          usersContainer.innerHTML = `<p class="empty-state" style="color: #ef4444;">Error loading users: ${err.message}</p>`;
        }
      });
  }

  function toggleUserBlock(userId, blocked) {
    const actionLabel = blocked ? "block" : "unblock";
    if (!confirm(`Are you sure you want to ${actionLabel} this user?`)) return;

    adminAuthFetch(`${API}/admin/users/${userId}/block`, {
      method: "PUT",
      body: JSON.stringify({ blocked: !!blocked })
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || `Failed to ${actionLabel} user`);
        return;
      }
      loadUsers();
    });
  }

  function toggleUserVerify(userId, verified) {
    adminAuthFetch(`${API}/admin/users/${userId}/verify`, {
      method: "PUT",
      body: JSON.stringify({ verified: !!verified })
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to update verification status");
        return;
      }
      loadUsers();
    });
  }

  function deleteUserAccount(userId) {
    if (!confirm("Delete this user account permanently?")) return;

    adminAuthFetch(`${API}/admin/users/${userId}`, {
      method: "DELETE"
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to delete user");
        return;
      }
      loadUsers();
    });
  }

  function requestAdminGrant(userId) {
    adminAuthFetch(`${API}/admin/users/${userId}/request-admin-grant`, {
      method: "POST"
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to request admin grant");
        return;
      }
      showError(data.message || "Approval requested. Ask test@sample.com for code.");
      loadGrantHistory();
    });
  }

  function promoteUserToAdmin(userId) {
    const approvalEmail = prompt("Enter approver email (must be test@sample.com):", "test@sample.com");
    if (!approvalEmail) return;

    const approvalCode = prompt("Enter approval code received from test@sample.com:");
    if (!approvalCode) return;

    adminAuthFetch(`${API}/admin/users/${userId}/make-admin`, {
      method: "PUT",
      body: JSON.stringify({ approvalEmail: approvalEmail.trim(), approvalCode: approvalCode.trim() })
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to promote user");
        return;
      }
      showError(data.message || "User promoted to admin");
      loadUsers();
      loadGrantHistory();
    });
  }

  function loadGrantHistory(status = grantHistoryFilter) {
    grantHistoryFilter = status;
    const container = document.getElementById("grantHistory");
    if (!container) return;

    adminAuthFetch(`${API}/admin/users/grants/history?status=${encodeURIComponent(grantHistoryFilter)}`)
      .then(res => res.json())
      .then(rows => {
        const items = Array.isArray(rows) ? rows : [];
        if (!items.length) {
          container.innerHTML = "<p class=\"empty-state\">No grant history found for this filter.</p>";
          return;
        }

        container.innerHTML = "";
        items.forEach(item => {
          const created = item.created_at ? new Date(item.created_at).toLocaleString() : "";
          const expires = item.expires_at ? new Date(item.expires_at).toLocaleString() : "";
          const approved = item.approved_at ? new Date(item.approved_at).toLocaleString() : "";
          const statusLabel = (item.effective_status || item.status || "pending").toLowerCase();
          const statusClass = statusLabel === "approved"
            ? "bg-green-100 text-green-700"
            : statusLabel === "expired"
              ? "bg-red-100 text-red-700"
              : "bg-yellow-100 text-yellow-700";

          container.innerHTML += `
            <article class="job-card admin-record">
              <div class="admin-record-head">
                <div>
                  <h4>${esc(item.target_name || "Unknown user")} (${esc(item.target_email || "n/a")})</h4>
                  <p class="p-muted">Requested by: ${esc(item.requested_by_name || "Unknown")} (${esc(item.requested_by_email || "n/a")})</p>
                  <p class="p-muted">Approver: ${esc(item.approver_email || "n/a")}</p>
                  <p class="p-muted">Created: ${created}${expires ? ` ΓÇó Expires: ${expires}` : ""}${approved ? ` ΓÇó Approved: ${approved}` : ""}</p>
                </div>
                <div class="admin-record-badges">
                  <span class="tag-pill ${statusClass}">${statusLabel}</span>
                </div>
              </div>
            </article>
          `;
        });
      })
      .catch((err) => {
        console.error("Error loading grant history:", err);
        container.innerHTML = `<p class="empty-state" style="color: #ef4444;">Error loading grant history: ${err.message}</p>`;
      });
  }

  function setGrantHistoryFilter(status) {
    loadGrantHistory(status);
  }

  function loadReviewQueue(status = reviewStatusFilter, source = reviewSourceFilter, verified = reviewVerifiedFilter) {
    reviewStatusFilter = status;
    reviewSourceFilter = source;
    reviewVerifiedFilter = verified;

    adminAuthFetch(`${API}/admin/reviews?status=${encodeURIComponent(reviewStatusFilter)}&source=${encodeURIComponent(reviewSourceFilter)}&verified=${encodeURIComponent(reviewVerifiedFilter)}`)
      .then(res => res.json())
      .then(reviews => {
        const container = document.getElementById("reviewQueue");
        if (!container) {
          console.error("reviewQueue container not found");
          return;
        }

        if (!reviews || !Array.isArray(reviews) || reviews.length === 0) {
          const labels = {
            pending: "pending",
            approved: "published",
            hidden: "hidden"
          };
          container.innerHTML = `<p>No ${labels[reviewStatusFilter] || "matching"} reviews</p>`;
          return;
        }

        container.innerHTML = "";
        reviews.forEach(review => {
          const stars = "ΓÿàΓÿàΓÿàΓÿàΓÿà".slice(0, review.rating) + "ΓÿåΓÿåΓÿåΓÿåΓÿå".slice(0, 5 - review.rating);
          const created = review.created_at ? new Date(review.created_at).toLocaleString() : "";
          const emailRow = review.email ? `<p class="meta">${esc(review.email)}</p>` : "";
          const source = review.source || reviewSourceFilter;
          const sourceBadge = `<span class="tag-pill bg-slate-100 text-slate-700">${esc(source)}</span>`;
          const verifiedBadge = Number(review.verified_review) === 1
            ? `<span class="tag-pill" style="background:#dcfce7;color:#166534;border:1px solid #86efac;">verified candidate review</span>`
            : "";
          const companyMeta = source === "company"
            ? `<p class="meta">Company: ${esc(review.company_name || "Unknown")} ${review.job_title ? `ΓÇó Job: ${esc(review.job_title)}` : ""} ${review.employer_name ? `ΓÇó Employer: ${esc(review.employer_name)}` : ""}</p>`
            : "";

          let actionButtons = `
            <button class="btn btn-outline" onclick="deleteReview(${review.id}, '${source}')">Delete</button>
          `;

          if (reviewStatusFilter === "pending") {
            actionButtons = `
              <button class="btn btn-primary" onclick="approveReview(${review.id}, '${source}')">Approve</button>
              <button class="btn btn-outline" onclick="deleteReview(${review.id}, '${source}')">Delete</button>
            `;
          } else if (reviewStatusFilter === "approved") {
            actionButtons = `
              <button class="btn btn-outline" onclick="hideReview(${review.id}, '${source}')">Hide</button>
              <button class="btn btn-outline" onclick="deleteReview(${review.id}, '${source}')">Delete</button>
            `;
          } else if (reviewStatusFilter === "hidden") {
            actionButtons = `
              <button class="btn btn-primary" onclick="unhideReview(${review.id}, '${source}')">Unhide</button>
              <button class="btn btn-outline" onclick="deleteReview(${review.id}, '${source}')">Delete</button>
            `;
          }

          container.innerHTML += `
            <div class="review-card">
              <div class="review-header">
                <div>
                  <h4>${esc(review.name)}</h4>
                  <p class="meta">${esc(review.role)}</p>
                  ${emailRow}
                  ${companyMeta}
                </div>
                <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                  ${sourceBadge}
                  ${verifiedBadge}
                  <span class="review-stars">${stars}</span>
                </div>
              </div>
              <p class="review-message">${esc(review.message)}</p>
              ${created ? `<p class="meta">Submitted: ${created}</p>` : ""}
              <div style="margin-top:12px; display:flex; gap:10px;">
                ${actionButtons}
              </div>
            </div>
          `;
        });
      })
      .catch(err => {
        console.error("Error loading reviews:", err);
        const container = document.getElementById("reviewQueue");
        if (container) {
          container.innerHTML = `<p class="empty-state" style="color: #ef4444;">Error loading reviews: ${err.message}</p>`;
        }
      });
  }

  function setReviewFilter(status) {
    loadReviewQueue(status, reviewSourceFilter, reviewVerifiedFilter);
  }

  function setReviewSource(source) {
    loadReviewQueue(reviewStatusFilter, source, reviewVerifiedFilter);
  }

  function setReviewSourceFilter(source) {
    setReviewSource(source);
  }

  function setReviewVerified(filter) {
    loadReviewQueue(reviewStatusFilter, reviewSourceFilter, filter);
  }

  function renderShiftJobs(shiftJobs) {
    const container = document.getElementById("shiftEscrows");
    if (!container) return;

    // Clear any "shift jobs" header previously rendered so escrow data can be appended
    const existingHeader = container.querySelector(".shift-jobs-header");
    if (existingHeader) existingHeader.remove();
    const existingList = container.querySelector(".shift-jobs-list");
    if (existingList) existingList.remove();

    if (!shiftJobs || !shiftJobs.length) return;

    const header = document.createElement("div");
    header.className = "shift-jobs-header";
    header.innerHTML = `<h4 style="margin:10px 0 8px;">Shift Job Postings</h4>`;
    container.prepend(header);

    const list = document.createElement("div");
    list.className = "shift-jobs-list";

    shiftJobs.forEach(job => {
      const shiftStart = job.shift_start ? new Date(job.shift_start).toLocaleString() : "";
      const shiftEnd = job.shift_end ? new Date(job.shift_end).toLocaleString() : "";
      const wageLabel = job.shift_hourly_rate ? `$${job.shift_hourly_rate}/hr` : "";
      const status = (job.shift_status || "posted");

      list.innerHTML += `
        <article class="job-card admin-record">
          <div class="admin-record-head">
            <div>
              <h4>${job.title}</h4>
              <p class="p-muted">${job.location || "No location"} ΓÇó ${job.category || "General"}</p>
              ${shiftStart ? `<p class="p-muted">Start: ${shiftStart}${shiftEnd ? " ΓÇö " + shiftEnd : ""}</p>` : ""}
            </div>
            <div class="admin-record-badges">
              <span class="tag-pill bg-cyan-100 text-cyan-700">Shift</span>
              ${wageLabel ? `<span class="tag-pill bg-green-100 text-green-700">${wageLabel}</span>` : ""}
              <span class="tag-pill bg-yellow-100 text-yellow-700">${status}</span>
            </div>
          </div>
          <div class="admin-record-actions">
            <button class="btn btn-outline" onclick="approveJob('${job.id}')">Approve</button>
            <button class="btn btn-outline" onclick="viewJobApplications('${job.id}')">Applications</button>
            <button class="btn btn-outline" onclick="deleteJob('${job.id}')">Delete</button>
            <button class="btn btn-outline" onclick="resendShiftAlerts(${job.id}, '${job.shift_paid ? "paid" : "posted"}')">Resend Alerts</button>
          </div>
        </article>
      `;
    });

    // Insert after header
    header.after(list);
  }

  function loadShiftEscrows() {
    adminAuthFetch(`${API}/admin/shifts`)
      .then(res => res.json())
      .then(rows => {
        const container = document.getElementById("shiftEscrows");
        if (!container) return;

        if (!rows.length) {
          container.innerHTML = "<p>No shift escrows yet</p>";
          return;
        }

        container.innerHTML = "";
        rows.forEach(row => {
          const created = row.created_at ? new Date(row.created_at).toLocaleString() : "";
          const releaseAt = row.release_at ? new Date(row.release_at).toLocaleString() : "";
          const status = row.status || "";
          const amount = row.total_cents ? `$${(row.total_cents / 100).toFixed(2)}` : "";
          const reason = row.dispute_reason ? `<div class="p-muted">Reason: ${row.dispute_reason}</div>` : "";

          container.innerHTML += `
            <div class="job-card">
              <h4>${row.job_title || "Shift"}</h4>
              <p>Client: ${row.client_name || ""} ΓÇó Worker: ${row.worker_name || ""}</p>
              <p>Status: <strong>${status}</strong> ${amount ? "ΓÇó " + amount : ""}</p>
              <p class="p-muted">Created: ${created}${releaseAt ? " ΓÇó Release at: " + releaseAt : ""}</p>
              ${reason}
              <div style="margin-top:10px; display:flex; gap:10px; flex-wrap:wrap;">
                <button class="btn btn-outline" onclick="disputeShift(${row.id})">Dispute</button>
                <button class="btn btn-outline" onclick="refundShift(${row.id})">Refund</button>
                <button class="btn btn-outline" onclick="releaseShift(${row.id})">Release</button>
                <button class="btn btn-outline" onclick="resendShiftAlerts(${row.job_id}, 'paid')">Resend alerts</button>
              </div>
            </div>
          `;
        });
      })
      .catch(err => {
        console.error("Error loading shift escrows:", err);
        const container = document.getElementById("shiftEscrows");
        if (container) {
          container.innerHTML = `<p class="empty-state" style="color: #ef4444;">Error loading escrows: ${err.message}</p>`;
        }
      });
  }

  function viewJobApplications(jobId) {
    adminAuthFetch(`${API}/admin/jobs/${jobId}/applications`)
      .then(res => res.json())
      .then(apps => {
        renderApplications(apps, `Applications for Job #${jobId}`);
        const appsContainer = document.getElementById("applications");
        if (appsContainer) {
          appsContainer.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
  }

  function renderApplications(apps, title) {
    const container = document.getElementById("applications");
    if (!container) return;

    if (!apps.length) {
      container.innerHTML = "<p>No applications found</p>";
      return;
    }

    container.innerHTML = `<h4 style="margin-bottom:10px;">${title}</h4>`;
    apps.forEach(app => {
      const created = app.created_at
        ? new Date(app.created_at).toLocaleDateString()
        : "";

      const cvLink = app.cv_path
        ? `<a href="${app.cv_path}" target="_blank" class="apply-btn">CV</a>`
        : "";

      const jobTitle = app.job_title ? app.job_title : "";
      const applicantName = app.full_name || app.user_name || "";
      const applicantEmail = app.email || app.user_email || "";

      container.innerHTML += `
        <article class="job-card admin-record">
          ${jobTitle ? `<h4>${esc(jobTitle)}</h4>` : ""}
          <p>${esc(applicantName)} ${applicantEmail ? "\u2022 " + esc(applicantEmail) : ""}</p>
          <p>Status: <strong>${esc(app.status)}</strong></p>
          <p>Applied: ${created}</p>
          ${cvLink}
          <div class="admin-record-actions" style="margin-top:10px;">
            <select id="status-${app.id}" class="form-input">
              <option value="pending" ${app.status === "pending" ? "selected" : ""}>Pending</option>
              <option value="reviewed" ${app.status === "reviewed" ? "selected" : ""}>Reviewed</option>
              <option value="accepted" ${app.status === "accepted" ? "selected" : ""}>Accepted</option>
              <option value="rejected" ${app.status === "rejected" ? "selected" : ""}>Rejected</option>
            </select>
            <button class="btn btn-outline" onclick="updateApplicationStatus(${app.id})">Update</button>
          </div>
        </article>
      `;
    });
  }

  function approveJob(id) {
    adminAuthFetch(`${API}/admin/jobs/${id}/approve`, {
      method: "PUT"
    }).then(() => loadJobs());
  }

  function deleteJob(id) {
    if (!confirm("Delete this job?")) return;

    adminAuthFetch(`${API}/admin/jobs/${id}`, {
      method: "DELETE"
    }).then(() => loadJobs());
  }

  function purgeTestJobs() {
    if (!confirm("This will permanently delete ALL jobs whose title contains 'test', 'demo', 'sample', or '[qa]'.\n\nProceed?")) return;

    adminAuthFetch(`${API}/admin/jobs/purge-demo`, { method: "DELETE" })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) { showError(data.error || "Purge failed"); return; }
        showError(data.message);
        loadJobs();
      })
      .catch((err) => showError("Purge request failed: " + err.message));
  }

  function makePremium(id) {
    const rawMethod = prompt("Choose payment method: card, applepay, gpay, paypal, bank_transfer", "card");
    const method = (rawMethod || "card").trim().toLowerCase();

    adminAuthFetch(`${API}/payments/create-checkout-session`, {
      method: "POST",
      body: JSON.stringify({ mode: "upgrade", jobId: id, payment_method: method })
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok || !data.url) {
        showError(data.message || "Failed to start payment");
        return;
      }
      window.location.href = data.url;
    });
  }

  function editJob(id) {
    const job = adminJobsCache.find(item => String(item.id) === String(id));
    if (!job) return;

    editJobId = id;
    adminJobTitle.value = job.title || "";
    adminJobLocation.value = job.location || "";
    adminJobType.value = job.job_type || job.jobType || "";
    adminJobCategory.value = job.category || "";
    adminJobDescription.value = job.description || "";
    adminJobPremium.checked = !!job.is_premium;

    adminJobSubmit.textContent = "Update Job";
    adminJobCancel.style.display = "inline-flex";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetAdminJobForm() {
    editJobId = null;
    adminJobForm.reset();
    adminJobSubmit.textContent = "Add Job";
    adminJobCancel.style.display = "none";
  }

  function updateApplicationStatus(id) {
    const select = document.getElementById(`status-${id}`);
    if (!select) return;

    adminAuthFetch(`${API}/applications/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status: select.value })
    }).then(() => loadApplications());
  }

  function approveReview(id, source = reviewSourceFilter) {
    adminAuthFetch(`${API}/admin/reviews/${id}/approve`, {
      method: "PUT",
      body: JSON.stringify({ source })
    }).then(() => loadReviewQueue(reviewStatusFilter));
  }

  function hideReview(id, source = reviewSourceFilter) {
    adminAuthFetch(`${API}/admin/reviews/${id}/hide`, {
      method: "PUT",
      body: JSON.stringify({ source })
    }).then(() => loadReviewQueue(reviewStatusFilter));
  }

  function unhideReview(id, source = reviewSourceFilter) {
    adminAuthFetch(`${API}/admin/reviews/${id}/unhide`, {
      method: "PUT",
      body: JSON.stringify({ source })
    }).then(() => loadReviewQueue(reviewStatusFilter));
  }

  function deleteReview(id, source = reviewSourceFilter) {
    if (!confirm("Delete this review permanently?")) return;

    adminAuthFetch(`${API}/admin/reviews/${id}`, {
      method: "DELETE",
      body: JSON.stringify({ source })
    }).then(() => loadReviewQueue(reviewStatusFilter));
  }

  function disputeShift(id) {
    const reason = prompt("Dispute reason (optional):") || "";
    const note = prompt("Internal note (optional):") || "";

    adminAuthFetch(`${API}/admin/shifts/${id}/dispute`, {
      method: "PUT",
      body: JSON.stringify({ reason, note })
    }).then(() => loadShiftEscrows());
  }

  function refundShift(id) {
    if (!confirm("Refund this shift escrow?")) return;

    adminAuthFetch(`${API}/admin/shifts/${id}/refund`, {
      method: "PUT"
    }).then(() => loadShiftEscrows());
  }

  function releaseShift(id) {
    if (!confirm("Release this shift escrow?")) return;

    adminAuthFetch(`${API}/admin/shifts/${id}/release`, {
      method: "PUT"
    }).then(() => loadShiftEscrows());
  }

  function resendShiftAlerts(jobId, status) {
    if (!confirm("Resend shift alerts to matching workers?")) return;

    adminAuthFetch(`${API}/admin/shifts/${jobId}/notify`, {
      method: "POST",
      body: JSON.stringify({ status })
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to resend alerts");
        return;
      }
      showSuccess("Shift alerts sent Γ£à");
    });
  }

  if (adminJobForm) {
    adminJobForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const payload = {
        title: adminJobTitle.value.trim(),
        location: adminJobLocation.value.trim(),
        job_type: adminJobType.value.trim(),
        category: adminJobCategory.value.trim(),
        description: adminJobDescription.value.trim(),
        is_premium: adminJobPremium.checked
      };

      const url = editJobId
        ? `${API}/admin/jobs/${editJobId}`
        : `${API}/admin/jobs`;

      const method = editJobId ? "PUT" : "POST";

      adminAuthFetch(url, {
        method,
        body: JSON.stringify(payload)
      }).then(() => {
        resetAdminJobForm();
        loadJobs();
      });
    });
  }

  if (adminJobCancel) {
    adminJobCancel.addEventListener("click", resetAdminJobForm);
  }

  function loadStats() {
    adminAuthFetch(`${API}/admin/stats`)
      .then(res => res.json())
      .then(stats => {
        const totalJobs = document.getElementById("totalJobs");
        const totalApplications = document.getElementById("totalApplications");
        const premiumJobs = document.getElementById("premiumJobs");
        const normalJobs = document.getElementById("normalJobs");

        if (totalJobs) totalJobs.textContent = stats.totalJobs || 0;
        if (totalApplications) totalApplications.textContent = stats.totalApplications || 0;
        if (premiumJobs) premiumJobs.textContent = stats.premiumJobs || 0;
        if (normalJobs) normalJobs.textContent = stats.normalJobs || 0;

        drawStatsChart(stats);
      });
  }

  function drawStatsChart(stats) {
    const canvas = document.getElementById("statsChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const width = canvas.width = canvas.clientWidth || 600;
    const height = canvas.height = canvas.clientHeight || 220;

    const jobs = stats.monthlyJobs || [];
    const apps = stats.monthlyApplications || [];

    const months = Array.from(
      new Set([...
        jobs.map(row => row.month),
        apps.map(row => row.month)
      ])
    ).sort();

    const jobMap = new Map(jobs.map(row => [row.month, row.count]));
    const appMap = new Map(apps.map(row => [row.month, row.count]));

    const values = months.map(month => ({
      month,
      jobs: jobMap.get(month) || 0,
      apps: appMap.get(month) || 0
    }));

    const maxValue = Math.max(1, ...values.map(v => Math.max(v.jobs, v.apps)));
    const padding = 30;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "rgba(248, 250, 252, 1)";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.45)";
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    const groupWidth = values.length ? chartWidth / values.length : chartWidth;
    const barWidth = Math.max(8, groupWidth / 3);

    values.forEach((item, index) => {
      const baseX = padding + index * groupWidth + groupWidth / 2;
      const jobsHeight = (item.jobs / maxValue) * chartHeight;
      const appsHeight = (item.apps / maxValue) * chartHeight;

      ctx.fillStyle = "#22c55e";
      ctx.fillRect(baseX - barWidth - 2, height - padding - jobsHeight, barWidth, jobsHeight);

      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(baseX + 2, height - padding - appsHeight, barWidth, appsHeight);

      ctx.fillStyle = "#475569";
      ctx.font = "10px Arial";
      ctx.textAlign = "center";
      ctx.fillText(item.month, baseX, height - padding + 12);
    });

    ctx.fillStyle = "#334155";
    ctx.font = "11px Arial";
    ctx.textAlign = "left";
    ctx.fillText("Jobs", padding, padding - 8);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(padding + 30, padding - 16, 10, 10);
    ctx.fillStyle = "#334155";
    ctx.fillText("Applications", padding + 50, padding - 8);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(padding + 125, padding - 16, 10, 10);
  }

  function loadModerationSettings() {
    if (!autoApproveToggle || !autoApproveMeta) return;

    adminAuthFetch(`${API}/admin/settings/auto-approval`)
      .then(res => res.json())
      .then(data => {
        autoApproveToggle.checked = !!data.enabled;
        autoApproveMeta.textContent = `Moderation provider: ${data.ai_provider || "heuristic-only"}`;
      })
      .catch((err) => {
        console.error(err);
        autoApproveMeta.textContent = "Failed to load moderation settings";
      });
  }

  function saveModerationSettings() {
    if (!autoApproveToggle) return;

    adminAuthFetch(`${API}/admin/settings/auto-approval`, {
      method: "PUT",
      body: JSON.stringify({ enabled: autoApproveToggle.checked })
    })
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          showError(data.error || "Failed to save moderation settings");
          return;
        }
        showSuccess(data.message || "Moderation settings updated");
        loadModerationSettings();
      })
      .catch((err) => {
        console.error(err);
        showError("Failed to save moderation settings");
      });
  }

  function loadCompanies() {
    adminAuthFetch(`${API}/admin/companies`)
      .then(res => res.json())
      .then(companies => {
        const container = document.getElementById("companies");
        if (!container) return;

        const list = Array.isArray(companies) ? companies : [];
        if (!list.length) {
          container.innerHTML = '<p class="empty-state">No companies registered yet.</p>';
          return;
        }

        container.innerHTML = "";
        list.forEach(company => {
          const created = company.created_at ? new Date(company.created_at).toLocaleDateString() : "";
          const logoHtml = company.logo_url
            ? `<img src="${esc(company.logo_url)}" alt="${esc(company.name)}" style="width:40px;height:40px;object-fit:contain;border-radius:6px;margin-right:12px;">`
            : "";

          container.innerHTML += `
            <article class="job-card admin-record">
              <div class="admin-record-head">
                <div style="display:flex;align-items:center;">
                  ${logoHtml}
                  <div>
                    <h4>${esc(company.name || "Unnamed company")}</h4>
                    <p class="p-muted">${esc(company.industry || "No industry")} \u2022 ${esc(company.location || "No location")}</p>
                    ${company.website ? `<p class="p-muted"><a href="${esc(company.website)}" target="_blank" rel="noopener noreferrer">${esc(company.website)}</a></p>` : ""}
                    ${created ? `<p class="p-muted">Registered: ${created}</p>` : ""}
                  </div>
                </div>
                <div class="admin-record-badges">
                  ${company.size ? `<span class="tag-pill bg-slate-100 text-slate-700">${company.size}</span>` : ""}
                </div>
              </div>
              <div class="admin-record-actions">
                <button class="btn btn-outline" onclick="deleteCompany(${company.id})">Delete</button>
              </div>
            </article>
          `;
        });
      })
      .catch(err => {
        console.error("Error loading companies:", err);
        const container = document.getElementById("companies");
        if (container) {
          container.innerHTML = `<p class="empty-state" style="color: #ef4444;">Error loading companies: ${err.message}</p>`;
        }
      });
  }

  function deleteCompany(id) {
    if (!confirm("Delete this company permanently? All associated jobs will lose their company link.")) return;

    adminAuthFetch(`${API}/admin/companies/${id}`, {
      method: "DELETE"
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to delete company");
        return;
      }
      loadCompanies();
    });
  }

  function closeJobHistoryModal() {
    const modal = document.getElementById("jobHistoryModal");
    if (modal) {
      modal.style.display = "none";
    }
  }

  window.loadJobs = loadJobs;
  window.approveJob = approveJob;
  window.deleteJob = deleteJob;
  window.makePremium = makePremium;
  window.purgeTestJobs = purgeTestJobs;
  window.toggleUserVerify = toggleUserVerify;
  window.editJob = editJob;
  window.viewJobApplications = viewJobApplications;
  window.updateApplicationStatus = updateApplicationStatus;
  window.approveReview = approveReview;
  window.hideReview = hideReview;
  window.unhideReview = unhideReview;
  window.deleteReview = deleteReview;
  window.setReviewFilter = setReviewFilter;
  window.setReviewSource = setReviewSource;
  window.setReviewSourceFilter = setReviewSourceFilter;
  window.setReviewVerified = setReviewVerified;
  window.disputeShift = disputeShift;
  window.refundShift = refundShift;
  window.releaseShift = releaseShift;
  window.resendShiftAlerts = resendShiftAlerts;
  window.closeJobHistoryModal = closeJobHistoryModal;
  window.loadUsers = loadUsers;
  window.toggleUserBlock = toggleUserBlock;
  window.deleteUserAccount = deleteUserAccount;
  window.requestAdminGrant = requestAdminGrant;
  window.promoteUserToAdmin = promoteUserToAdmin;
  window.setGrantHistoryFilter = setGrantHistoryFilter;
  window.loadCompanies = loadCompanies;
  window.deleteCompany = deleteCompany;

  saveAutoApproveBtn?.addEventListener("click", saveModerationSettings);

  loadJobs();
  loadApplications();
  loadReviewQueue();
  loadShiftEscrows();
  loadUsers();
  loadGrantHistory();
  loadCompanies();
  loadStats();
  loadModerationSettings();
})();
