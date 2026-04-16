document.addEventListener("DOMContentLoaded", async () => {
  const token = localStorage.getItem("token");
  if (!token) {
    alert("Login required");
    window.location.href = "login.html";
    return;
  }

  // Show "Post a job" hero button only for employers/admins
  // Also update hero text to match the user's role
  try {
    const dashUser = JSON.parse(localStorage.getItem("user") || "{}");
    const dashPostBtn = document.getElementById("dashboardPostJobBtn");
    const dashCompanyBtn = document.getElementById("dashboardCompanyBtn");
    if (dashPostBtn && (dashUser.role === "employer" || dashUser.is_admin)) {
      dashPostBtn.style.display = "inline-flex";
    }
    if (dashCompanyBtn && (dashUser.role === "employer" || dashUser.is_admin)) {
      dashCompanyBtn.style.display = "inline-flex";
    }
    if (dashUser.role === "employer" || dashUser.is_admin) {
      const eyebrow = document.getElementById("dashboardEyebrow");
      const title = document.getElementById("dashboardTitle");
      const subtitle = document.getElementById("dashboardSubtitle");
      if (eyebrow) eyebrow.textContent = dashUser.is_admin ? "Admin dashboard" : "Employer dashboard";
      if (title) title.textContent = "Manage your job postings, applications, and shift alerts";
      if (subtitle) subtitle.textContent = "Post jobs, review candidates, and track your recruitment pipeline in one place.";
    }
  } catch (e) { /* ignore */ }

  const container = document.getElementById("applications");
  const searchInput = document.getElementById("searchInput");
  const statusFilter = document.getElementById("statusFilter");
  const sortBy = document.getElementById("sortBy");
  const savedContainer = document.getElementById("savedJobs");
  const alertsList = document.getElementById("alertsList");
  const alertForm = document.getElementById("alertForm");
  const shiftAlertsList = document.getElementById("shiftAlerts");
  const shiftAlertRules = document.getElementById("shiftAlertRules");
  const shiftAlertCount = document.getElementById("shiftAlertCount");
  const refreshShiftAlerts = document.getElementById("refreshShiftAlerts");
  const createShiftAlertBtn = document.getElementById("createShiftAlertBtn");
  const referralForm = document.getElementById("referralForm");
  const referralsList = document.getElementById("referralsList");
  const referralRewardsEarned = document.getElementById("referralRewardsEarned");
  const referralRewardsPaid = document.getElementById("referralRewardsPaid");
  const referralRewardsPending = document.getElementById("referralRewardsPending");
  const myInterviewsContainer = document.getElementById("myInterviews");
  const myBackgroundChecksContainer = document.getElementById("myBackgroundChecks");
  const interviewReminderEnabledInput = document.getElementById("interviewReminderEnabled");
  const interviewReminderLeadTimeInput = document.getElementById("interviewReminderLeadTime");
  const interviewReminderSaveBtn = document.getElementById("interviewReminderSaveBtn");
  const referralNameInput = document.getElementById("referralName");
  const referralEmailInput = document.getElementById("referralEmail");
  const referralNoteInput = document.getElementById("referralNote");
  const alertKeywordInput = document.getElementById("alertKeyword");
  const alertLocationInput = document.getElementById("alertLocation");
  const alertCategoryInput = document.getElementById("alertCategory");
  const alertCategoryCustomWrap = document.getElementById("alertCategoryCustomWrap");
  const alertCategoryCustomInput = document.getElementById("alertCategoryCustom");
  const alertTypeInput = document.getElementById("alertType");
  const alertFrequencyInput = document.getElementById("alertFrequency");

  if (!container) return;

  let allApps = [];
  let alerts = [];
  let myInterviews = [];
  let interviewCountdownTicker = null;
  const INTERVIEW_REMINDER_KEY = "dashboardInterviewReminders.v1";
  const INTERVIEW_REMINDER_SETTINGS_KEY = "dashboardInterviewReminderSettings.v1";

  const jobAlertsList = document.getElementById("jobAlerts");
  const jobAlertCount = document.getElementById("jobAlertCount");
  const refreshJobAlerts = document.getElementById("refreshJobAlerts");

  const statusOrder = ["pending", "reviewed", "accepted", "rejected"];

  const syncAlertCustomCategoryField = () => {
    const isOther = (alertCategoryInput?.value || "").toLowerCase() === "other";
    if (alertCategoryCustomWrap) {
      alertCategoryCustomWrap.style.display = isOther ? "block" : "none";
    }
    if (!isOther && alertCategoryCustomInput) {
      alertCategoryCustomInput.value = "";
    }
  };

  const resolveAlertCategoryPayload = () => {
    const selected = (alertCategoryInput?.value || "").trim();
    if (selected.toLowerCase() !== "other") {
      return { category: selected, category_custom: "" };
    }
    return {
      category: "Other",
      category_custom: (alertCategoryCustomInput?.value || "").trim()
    };
  };

  const readResponsePayload = async (res) => {
    const contentType = String(res.headers.get("content-type") || "").toLowerCase();
    try {
      if (contentType.includes("application/json")) {
        return await res.json();
      }
      const text = await res.text();
      return text ? { message: text.slice(0, 300) } : null;
    } catch (_err) {
      return null;
    }
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const isTransientAlertFailure = (status, payload) => {
    const text = String(payload?.message || payload?.error || "").toLowerCase();
    const isLockIssue = /deadlock|lock wait timeout|try restarting transaction|lock/i.test(text);
    return status >= 500 && isLockIssue;
  };

  const requestAlertApi = async (url, options = {}) => {
    const attempt = async () => {
      const res = await authFetch(url, options);
      const data = await readResponsePayload(res);
      return { res, data };
    };

    let firstError = null;
    try {
      const first = await attempt();
      if (!first.res.ok && isTransientAlertFailure(first.res.status, first.data)) {
        await delay(250);
        return await attempt();
      }
      return first;
    } catch (err) {
      firstError = err;
    }

    if (firstError?.message === "Failed to fetch") {
      await delay(250);
      return await attempt();
    }

    throw firstError;
  };

  const pipelineLabel = (stage) => {
    const value = (stage || "new").toString().toLowerCase();
    return value.charAt(0).toUpperCase() + value.slice(1);
  };

  const formatDeadlineMeta = (app) => {
    if (!app.application_deadline) {
      return '<span class="meta">Deadline: Open</span>';
    }

    const deadlineDate = new Date(app.application_deadline);
    if (Number.isNaN(deadlineDate.valueOf())) {
      return '<span class="meta">Deadline: Not available</span>';
    }

    const isOpen = Number(app.is_open_for_applications) === 1;
    const formatted = deadlineDate.toLocaleString();

    if (!isOpen) {
      return `<span class="meta">Deadline passed: ${formatted}</span>`;
    }

    return `<span class="meta">Apply by: ${formatted}</span>`;
  };

  const normalizeStatus = (value) => {
    return (value || "").toLowerCase();
  };

  const setStats = (apps) => {
    const statTotal = document.getElementById("statTotal");
    const statPending = document.getElementById("statPending");
    const statReviewed = document.getElementById("statReviewed");
    const statAccepted = document.getElementById("statAccepted");

    const counts = apps.reduce(
      (acc, app) => {
        const status = normalizeStatus(app.status);
        acc.total += 1;
        if (status === "pending") acc.pending += 1;
        if (status === "reviewed") acc.reviewed += 1;
        if (status === "accepted") acc.accepted += 1;
        return acc;
      },
      { total: 0, pending: 0, reviewed: 0, accepted: 0 }
    );

    if (statTotal) statTotal.textContent = counts.total;
    if (statPending) statPending.textContent = counts.pending;
    if (statReviewed) statReviewed.textContent = counts.reviewed;
    if (statAccepted) statAccepted.textContent = counts.accepted;
  };

  const renderApplications = (apps) => {
    if (!apps.length) {
      container.innerHTML = "<div class=\"empty-state\"><p>You haven't applied to any jobs yet.</p><p><a href=\"jobs.html\" class=\"btn btn-primary\">Browse Jobs</a></p></div>";
      return;
    }

    container.innerHTML = "";
    const formatShiftMeta = (app) => {
      if (!app.is_shift) return "";
      const pay = app.shift_pay_cents ? `$${(app.shift_pay_cents / 100).toFixed(2)}` : "";
      const start = app.shift_start ? new Date(app.shift_start).toLocaleString() : "";
      const end = app.shift_end ? new Date(app.shift_end).toLocaleString() : "";
      const time = start && end ? `${start} - ${end}` : start || end;
      const parts = [pay, time].filter(Boolean).join(" • ");
      return parts ? `<div class="p-muted">${parts}</div>` : "";
    };

    const renderShiftActions = (app) => {
      if (!app.is_shift || !app.escrow_id) return "";
      if (app.escrow_status !== "awaiting_confirmation") return "";
      if (app.worker_confirmed) {
        return "<div class=\"p-muted\">You confirmed completion.</div>";
      }
      return `
        <button class="btn btn-outline" type="button" data-action="worker-confirm" data-job-id="${app.job_id}">
          Confirm shift completion
        </button>
      `;
    };

    const renderShiftBadge = (app) => {
      if (!app.is_shift) return "";
      const status = (app.escrow_status || app.shift_status || "open").toLowerCase();
      const label = status.replace(/_/g, " ");
      return `<span class="status-pill status-${status}">${label}</span>`;
    };

    apps.forEach(app => {
      const created = app.created_at ? new Date(app.created_at).toLocaleDateString() : "";
      const status = normalizeStatus(app.status);
      const statusIndex = Math.max(0, statusOrder.indexOf(status));
      const stage = (app.pipeline_stage || "new").toLowerCase();

      const cvLink = app.cv_path
        ? `<a href="${app.cv_path}" target="_blank" class="btn btn-outline">View CV</a>`
        : "";

      container.innerHTML += `
        <article class="app-card">
          <div class="app-card__header">
            <div>
              <h3>${esc(app.title)}</h3>
              <p class="meta">${esc(app.location || "")} ${app.job_type ? "• " + esc(app.job_type) : ""}</p>
              <p class="meta">Pipeline stage: ${esc(pipelineLabel(stage))}</p>
            </div>
            <div class="status-stack">
              <span class="status-pill status-${status}">${esc(app.status)}</span>
              ${renderShiftBadge(app)}
            </div>
          </div>
          <div class="app-timeline">
            ${statusOrder
              .map((step, index) => {
                const stepLabel = step.charAt(0).toUpperCase() + step.slice(1);
                const activeClass = index <= statusIndex ? "active" : "";
                return `<span class="timeline-dot ${activeClass}">${stepLabel}</span>`;
              })
              .join("")}
          </div>
          ${app.is_shift ? `<div class="shift-meta">${formatShiftMeta(app)}</div>` : ""}
          <div class="app-card__footer">
            <span class="meta">Applied: ${created}</span>
            ${formatDeadlineMeta(app)}
            <div class="actions">
              ${renderShiftActions(app)}
              ${cvLink}
            </div>
          </div>
        </article>
      `;
    });
  };

  const applyFilters = () => {
    const term = (searchInput?.value || "").trim().toLowerCase();
    const status = statusFilter?.value || "all";
    const sort = sortBy?.value || "recent";

    let filtered = [...allApps];

    if (term) {
      filtered = filtered.filter(app => {
        const title = (app.title || "").toLowerCase();
        const location = (app.location || "").toLowerCase();
        return title.includes(term) || location.includes(term);
      });
    }

    if (status !== "all") {
      filtered = filtered.filter(app => normalizeStatus(app.status) === status);
    }

    if (sort === "recent") {
      filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    if (sort === "oldest") {
      filtered.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }

    if (sort === "title") {
      filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    }

    renderApplications(filtered);
  };

  const renderSavedJobs = (jobs) => {
    if (!savedContainer) return;

    if (!jobs.length) {
      savedContainer.innerHTML = "<div class=\"empty-state\"><p>You haven't saved any jobs yet.</p><p><a href=\"jobs.html\" class=\"btn btn-primary\">Browse Jobs</a></p></div>";
      return;
    }

    savedContainer.innerHTML = "";
    jobs.forEach(job => {
      const premiumBadge = job.is_premium
        ? '<span class="badge badge-premium">Premium</span>'
        : "";

      const company = job.company_name ? ` \u2022 ${esc(job.company_name)}` : "";
      const jobType = job.job_type || job.jobType || "";

      savedContainer.innerHTML += `
        <article class="job-card">
          <h3>${esc(job.title)} ${premiumBadge}</h3>
          <p class="meta">${esc(job.location || "")}${jobType ? " \u2022 " + esc(jobType) : ""}${company}</p>
          <div class="job-card-actions">
            <a href="apply.html?jobId=${job.id}" class="apply-btn" data-job-id="${job.id}">Apply</a>
            <button class="btn btn-outline save-btn" type="button" data-save-id="${job.id}" data-saved="1">Remove</button>
          </div>
        </article>
      `;
    });
  };

  const loadSavedJobs = async () => {
    if (!savedContainer) return;
    try {
      console.log('Loading saved jobs...');
      const res = await authFetch(`${API}/saved-jobs`);
      const jobs = await readResponsePayload(res);
      if (!res.ok) {
        console.error('Failed to load saved jobs:', jobs);
        savedContainer.innerHTML = "<p class=\"empty-state\">Failed to load saved jobs. Please try refreshing the page.</p>";
        return;
      }
      console.log('Saved jobs loaded:', jobs);
      renderSavedJobs(jobs || []);
    } catch (err) {
      console.error('Error loading saved jobs:', err);
      savedContainer.innerHTML = "<p class=\"empty-state\">Server error loading saved jobs. Please check your connection.</p>";
    }
  };

  const loadApplications = async () => {
    if (!container) return;
    try {
      console.log('Loading applications...');
      const res = await authFetch(`${API}/applications/my`);
      const data = await readResponsePayload(res);
      if (!res.ok) {
        console.error('Failed to load applications:', data);
        container.innerHTML = "<p class=\"empty-state\">Failed to load applications. Please try refreshing the page.</p>";
        return;
      }
      console.log('Applications loaded:', data);
      allApps = Array.isArray(data) ? data : [];
      setStats(allApps);
      renderApplications(allApps);
    } catch (err) {
      console.error('Error loading applications:', err);
      container.innerHTML = "<p class=\"empty-state\">Server error loading applications. Please check your connection.</p>";
    }
  };

  // ── Recommendations ────────────────────────────────────────────────────────

  const getSalaryLabelRec = (job) => {
    if (job.salary_min && job.salary_max) return `$${Number(job.salary_min).toLocaleString()} – $${Number(job.salary_max).toLocaleString()}`;
    if (job.salary_min) return `From $${Number(job.salary_min).toLocaleString()}`;
    if (job.salary_max) return `Up to $${Number(job.salary_max).toLocaleString()}`;
    if (job.shift_pay_cents) return `$${Math.round(job.shift_pay_cents / 100)}`;
    return "Competitive";
  };

  const renderRecommendationCard = (job) => {
    const score = job.match_score || 0;
    const scoreBar = `<div class="rec-score-bar" style="width:${score}%;background:${score >= 70 ? "#16a34a" : score >= 40 ? "#d97706" : "#6b7280"};"></div>`;
    const remote = job.is_remote ? '<span class="badge" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;">Remote</span> ' : "";
    const premium = job.is_premium ? '<span class="badge badge-premium">Premium</span> ' : "";
    return `
      <article class="job-card" style="position:relative;">
        <div style="font-size:.75rem;font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:8px;">
          <span style="opacity:.55;text-transform:uppercase;letter-spacing:.05em;">Match</span>
          <div style="flex:1;height:4px;background:#f3f4f6;border-radius:2px;overflow:hidden;">${scoreBar}</div>
          <span style="color:${score >= 70 ? "#16a34a" : score >= 40 ? "#d97706" : "#6b7280"};min-width:32px;text-align:right;">${score}%</span>
        </div>
        <h3 style="margin:0 0 4px;">${esc(job.title)} ${premium}</h3>
        <p class="meta">${esc(job.location || "Remote")} &bull; ${esc(job.job_type || "Full-time")}${job.experience_level ? " &bull; " + esc(job.experience_level) : ""}</p>
        ${job.company_name ? `<p class="meta" style="margin-top:2px;">${esc(job.company_name)}</p>` : ""}
        <p class="meta" style="margin-top:4px;">${remote}<i class="fa-solid fa-sack-dollar" style="opacity:.5;margin-right:4px;"></i>${getSalaryLabelRec(job)}</p>
        <div class="job-card-actions" style="margin-top:12px;">
          <a href="job.html?id=${job.id}" class="btn btn-outline" style="font-size:.85rem;">View</a>
          <a href="apply.html?jobId=${job.id}" class="apply-btn" style="font-size:.85rem;">Apply</a>
        </div>
      </article>
    `;
  };

  let recPage = 10;

  const loadRecommendations = async (limit = 10) => {
    const grid = document.getElementById("recommendationsGrid");
    const skeleton = document.getElementById("recommendationsSkeleton");
    const empty = document.getElementById("recommendationsEmpty");
    const loadMoreBtn = document.getElementById("loadMoreRecommendations");
    if (!grid) return;

    if (skeleton) {
      skeleton.innerHTML = Array.from({ length: 4 }).map(() => "<div class=\"skeleton-card\"></div>").join("");
      skeleton.classList.remove("hidden");
    }

    try {
      const res = await authFetch(`${API}/recommendations?limit=${limit}`);
      if (skeleton) skeleton.classList.add("hidden");

      if (!res.ok) {
        if (empty) empty.style.display = "";
        return;
      }

      const recs = await res.json();

      if (!recs || !recs.length) {
        if (empty) empty.style.display = "";
        return;
      }

      if (empty) empty.style.display = "none";
      grid.innerHTML = recs.map(renderRecommendationCard).join("");

      if (loadMoreBtn) {
        loadMoreBtn.style.display = recs.length >= limit ? "inline-flex" : "none";
        loadMoreBtn.onclick = () => {
          recPage += 10;
          loadRecommendations(recPage);
        };
      }
    } catch (err) {
      console.error("Recommendations error:", err);
      if (skeleton) skeleton.classList.add("hidden");
      if (empty) empty.style.display = "";
    }
  };

  const renderAlerts = (list) => {
    if (!alertsList) return;

    if (!list.length) {
      alertsList.innerHTML = "<p class=\"empty-state\">No alerts yet.</p>";
      return;
    }

    alertsList.innerHTML = "";
    list.forEach(alert => {
      const filters = [
        alert.keyword ? `Keyword: ${esc(alert.keyword)}` : "",
        alert.location ? `Location: ${esc(alert.location)}` : "",
        alert.category ? `Category: ${esc(alert.category)}` : "",
        alert.job_type ? `Type: ${esc(alert.job_type)}` : ""
      ].filter(Boolean).join(" | ");

      alertsList.innerHTML += `
        <div class="alert-card">
          <div>
            <div class="alert-title">${filters || "All jobs"}</div>
            <div class="p-muted">Frequency: ${esc(alert.frequency)}</div>
          </div>
          <div class="alert-actions">
            <button class="btn btn-outline" type="button" data-action="toggle" data-id="${alert.id}">
              ${alert.is_active ? "Deactivate" : "Activate"}
            </button>
            <button class="btn btn-outline" type="button" data-action="delete" data-id="${alert.id}">Delete</button>
          </div>
        </div>
      `;
    });
  };

  const isShiftRule = (alert) => {
    const type = String(alert?.job_type || "").toLowerCase();
    return type === "shift";
  };

  const renderShiftRules = (list) => {
    if (!shiftAlertRules) return;

    const rules = (list || []).filter(isShiftRule);
    if (!rules.length) {
      shiftAlertRules.innerHTML = "<p class=\"empty-state\">No shift alert preferences yet.</p>";
      return;
    }

    shiftAlertRules.innerHTML = "";
    rules.forEach((alert) => {
      const filters = [
        alert.keyword ? `Keyword: ${esc(alert.keyword)}` : "",
        alert.location ? `Location: ${esc(alert.location)}` : "",
        alert.category ? `Category: ${esc(alert.category)}` : ""
      ].filter(Boolean).join(" | ");

      shiftAlertRules.innerHTML += `
        <div class="alert-card">
          <div>
            <div class="alert-title">${filters || "All shift jobs"}</div>
            <div class="p-muted">Type: Shift • Frequency: ${esc(alert.frequency || "daily")}</div>
          </div>
          <div class="alert-actions">
            <button class="btn btn-outline" type="button" data-action="edit-shift-rule" data-id="${alert.id}">Edit</button>
            <button class="btn btn-outline" type="button" data-action="toggle-shift-rule" data-id="${alert.id}">
              ${alert.is_active ? "Deactivate" : "Activate"}
            </button>
            <button class="btn btn-outline" type="button" data-action="delete-shift-rule" data-id="${alert.id}">Delete</button>
          </div>
        </div>
      `;
    });
  };

  const resetShiftAlertBuilder = () => {
    editingShiftAlertId = null;
    shiftAlertForm?.reset();
    const submitBtn = shiftAlertForm?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Save Shift Alert";
  };

  const startEditingShiftRule = (alert) => {
    if (!shiftAlertBuilder || !alert) return;

    editingShiftAlertId = alert.id;
    const keywordInput = document.getElementById("shiftAlertKeyword");
    const locationInput = document.getElementById("shiftAlertLocation");
    const categoryInput = document.getElementById("shiftAlertCategory");
    const frequencyInput = document.getElementById("shiftAlertFrequency");
    if (keywordInput) keywordInput.value = alert.keyword || "";
    if (locationInput) locationInput.value = alert.location || "";
    if (categoryInput) categoryInput.value = alert.category || "";
    if (frequencyInput) frequencyInput.value = alert.frequency || "daily";

    const submitBtn = shiftAlertForm?.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.textContent = "Update Shift Alert";

    shiftAlertBuilder.style.display = "block";
    keywordInput?.focus();
  };

  const loadAlerts = async () => {
    if (!alertsList) return;
    try {
      const res = await authFetch(`${API}/job-alerts`);
      const data = await readResponsePayload(res);
      if (!res.ok) {
        alertsList.innerHTML = "<p class=\"empty-state\">Failed to load alerts.</p>";
        return;
      }
      alerts = data || [];
      renderAlerts(alerts);
      renderShiftRules(alerts);
    } catch (err) {
      console.error(err);
      alertsList.innerHTML = "<p class=\"empty-state\">Server error.</p>";
      if (shiftAlertRules) {
        shiftAlertRules.innerHTML = "<p class=\"empty-state\">Server error.</p>";
      }
    }
  };

  const renderShiftAlerts = (items) => {
    if (!shiftAlertsList) return;

    // Filter for only active shift alerts (deadline and shift end still valid)
    const activeItems = items.filter(item => {
      const now = new Date();
      const shiftEnd = item.shift_end ? new Date(item.shift_end) : null;
      const isOpenForApplications = Number(item.is_open_for_applications) === 1;
      return shiftEnd && shiftEnd > now && isOpenForApplications;
    });

    if (!activeItems.length) {
      shiftAlertsList.innerHTML = "<div class=\"empty-state\"><p>No active shift alerts at the moment.</p><p>Shift alerts will appear here when employers post shift jobs that match your alert criteria.</p></div>";
      if (shiftAlertCount) shiftAlertCount.textContent = "0";
      return;
    }

    const unread = activeItems.filter(item => !item.is_read).length;
    if (shiftAlertCount) shiftAlertCount.textContent = String(unread);

    shiftAlertsList.innerHTML = "";
    activeItems.forEach(item => {
      const pay = item.shift_pay_cents ? `$${(item.shift_pay_cents / 100).toFixed(2)}` : "";
      const start = item.shift_start ? new Date(item.shift_start).toLocaleString() : "";
      const end = item.shift_end ? new Date(item.shift_end).toLocaleString() : "";
      const time = start && end ? `${start} - ${end}` : start || end;
      const meta = [pay, time, esc(item.location || "")].filter(v => v !== "").join(" \u2022 ");
      const status = esc((item.status || "posted").replace(/_/g, " "));

      shiftAlertsList.innerHTML += `
        <div class="shift-alert-card ${item.is_read ? "" : "unread"}">
          <div>
            <div class="shift-alert-title">${esc(item.title)}</div>
            <div class="p-muted">${meta}</div>
            <div class="p-muted">Status: ${status}</div>
          </div>
          <div class="shift-alert-actions">
            <a class="btn btn-outline" href="apply.html?jobId=${item.job_id}">Apply</a>
            <button class="btn btn-outline" type="button" data-action="read" data-id="${item.id}">
              Mark read
            </button>
          </div>
        </div>
      `;
    });
  };

  const loadShiftAlerts = async () => {
    if (!shiftAlertsList) return;
    try {
      console.log('Loading shift alerts...');
      const res = await authFetch(`${API}/job-alerts/shift-notifications`);
      const data = await readResponsePayload(res);
      if (!res.ok) {
        console.error('Failed to load shift alerts:', data);
        shiftAlertsList.innerHTML = "<p class=\"empty-state\">Failed to load shift alerts. Please try refreshing the page.</p>";
        return;
      }
      console.log('Shift alerts loaded:', data);
      renderShiftAlerts(data || []);
    } catch (err) {
      console.error('Error loading shift alerts:', err);
      shiftAlertsList.innerHTML = "<p class=\"empty-state\">Server error loading shift alerts. Please check your connection.</p>";
    }
  };

  const renderJobAlerts = (items) => {
    if (!jobAlertsList) return;

    const activeItems = items.filter(item => {
      const now = new Date();
      const deadline = item.application_deadline ? new Date(item.application_deadline) : null;
      const isOpenForApplications = Number(item.is_open_for_applications) === 1;
      return isOpenForApplications && (!deadline || deadline > now);
    });

    if (!activeItems.length) {
      jobAlertsList.innerHTML = "<div class=\"empty-state\"><p>No matching job alerts at the moment.</p><p>Job alerts will appear here when new jobs match your alert criteria.</p></div>";
      if (jobAlertCount) jobAlertCount.textContent = "0";
      return;
    }

    if (jobAlertCount) jobAlertCount.textContent = String(activeItems.length);

    jobAlertsList.innerHTML = "";
    activeItems.forEach(item => {
      const deadline = item.application_deadline ? new Date(item.application_deadline) : null;
      const deadlineText = deadline ? deadline.toLocaleString() : "Open";
      const meta = [item.job_type, item.category, item.location].filter(Boolean).map(esc).join(" \u2022 ");
      const salary = item.salary ? esc(String(item.salary)) : "";

      jobAlertsList.innerHTML += `
        <div class="job-alert-card">
          <div>
            <div class="job-alert-title">${esc(item.title)}</div>
            <div class="p-muted">${meta}</div>
            ${salary ? `<div class="p-muted">Salary: ${salary}</div>` : ""}
            <div class="p-muted">Deadline: ${deadlineText}</div>
          </div>
          <div class="job-alert-actions">
            <a class="btn btn-outline" href="job.html?jobId=${item.id}">View</a>
            <a class="btn btn-outline" href="apply.html?jobId=${item.id}">Apply</a>
          </div>
        </div>
      `;
    });
  };

  const loadJobAlerts = async () => {
    if (!jobAlertsList) return;
    try {
      console.log('Loading job alerts...');
      const res = await authFetch(`${API}/job-alerts/job-notifications`);
      const data = await readResponsePayload(res);
      if (!res.ok) {
        console.error('Failed to load job alerts:', data);
        jobAlertsList.innerHTML = "<p class=\"empty-state\">Failed to load job alerts. Please try refreshing the page.</p>";
        return;
      }
      console.log('Job alerts loaded:', data);
      renderJobAlerts(data || []);
    } catch (err) {
      console.error('Error loading job alerts:', err);
      jobAlertsList.innerHTML = "<p class=\"empty-state\">Server error loading job alerts. Please check your connection.</p>";
    }
  };

const formatCentsToUsd = (cents) => {
    const value = Number(cents || 0) / 100;
    return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const renderReferralRows = (rows) => {
    if (!referralsList) return;
    if (!rows.length) {
      referralsList.innerHTML = "<p class=\"empty-state\">No referrals yet. Add your first candidate above.</p>";
      return;
    }

    referralsList.innerHTML = "";
    rows.forEach((row) => {
      const created = row.created_at ? new Date(row.created_at).toLocaleDateString() : "";
      const hiredAt = row.hired_at ? new Date(row.hired_at).toLocaleDateString() : "";
      const status = (row.status || "pending").toLowerCase();
      const reward = row.amount_cents ? formatCentsToUsd(row.amount_cents) : "-";

      referralsList.innerHTML += `
        <article class="app-card">
          <div class="app-card__header">
            <div>
              <h3>${esc(row.referred_name || "Referred candidate")}</h3>
              <p class="meta">${esc(row.referred_email || "")}</p>
              <p class="meta">Created: ${created}${hiredAt ? ` · Hired: ${hiredAt}` : ""}</p>
            </div>
            <div class="status-stack">
              <span class="status-pill status-${status}">${esc(status.replace(/_/g, " "))}</span>
            </div>
          </div>
          <div class="app-card__footer">
            <span class="meta">Code: ${esc(row.referral_code || "-")}</span>
            <span class="meta">Reward: ${esc(reward)}</span>
          </div>
          ${row.note ? `<p class="p-muted">${esc(row.note)}</p>` : ""}
        </article>
      `;
    });
  };

  const formatInterviewDateTime = (value) => {
    if (!value) return "TBD";
    const d = new Date(value);
    if (Number.isNaN(d.valueOf())) return "TBD";
    return d.toLocaleString();
  };

  const toCalendarTimestamp = (value) => {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.valueOf())) return "";
    const pad = (v) => String(v).padStart(2, "0");
    return (
      `${d.getUTCFullYear()}` +
      `${pad(d.getUTCMonth() + 1)}` +
      `${pad(d.getUTCDate())}` +
      "T" +
      `${pad(d.getUTCHours())}` +
      `${pad(d.getUTCMinutes())}` +
      `${pad(d.getUTCSeconds())}` +
      "Z"
    );
  };

  const getInterviewWindow = (row) => {
    const start = new Date(row.scheduled_at);
    if (Number.isNaN(start.valueOf())) return null;
    const minutes = Math.max(15, Number(row.duration_minutes || 30));
    const end = new Date(start.getTime() + minutes * 60 * 1000);
    return { start, end };
  };

  const buildInterviewCalendarUrls = (row) => {
    const slot = getInterviewWindow(row);
    if (!slot) return { google: "", outlook: "" };

    const title = `Interview - ${row.job_title || "Job Opportunity"}`;
    const details = [
      `Employer: ${row.employer_name || "Employer"}`,
      `Meeting type: ${row.meeting_type || "video"}`,
      row.meeting_link ? `Meeting link: ${row.meeting_link}` : "",
      row.notes ? `Notes: ${row.notes}` : ""
    ].filter(Boolean).join("\n");
    const location = row.meeting_type === "onsite"
      ? (row.job_location || "Onsite")
      : (row.meeting_link || "Online");

    const startIso = slot.start.toISOString();
    const endIso = slot.end.toISOString();
    const startStamp = toCalendarTimestamp(slot.start);
    const endStamp = toCalendarTimestamp(slot.end);

    const googleParams = new URLSearchParams({
      action: "TEMPLATE",
      text: title,
      dates: `${startStamp}/${endStamp}`,
      details,
      location
    });

    const outlookParams = new URLSearchParams({
      path: "/calendar/action/compose",
      rru: "addevent",
      subject: title,
      startdt: startIso,
      enddt: endIso,
      body: details,
      location
    });

    return {
      google: `https://calendar.google.com/calendar/render?${googleParams.toString()}`,
      outlook: `https://outlook.live.com/calendar/0/deeplink/compose?${outlookParams.toString()}`
    };
  };

  const bgStatusStages = ["pending", "in_progress", "clear", "consider", "failed", "cancelled"];

  const renderBackgroundStatusTimeline = (status) => {
    const current = String(status || "pending").toLowerCase();
    const currentIndex = Math.max(0, bgStatusStages.indexOf(current));
    return bgStatusStages.map((stage, idx) => {
      const label = stage.replace(/_/g, " ");
      const active = idx <= currentIndex ? "is-active" : "";
      const terminal = (current === "failed" || current === "cancelled") && idx > currentIndex ? "is-muted" : "";
      const currentClass = idx === currentIndex ? `is-current stage-${stage}` : "";
      return `<span class="bg-check-stage ${active} ${terminal} ${currentClass}">${esc(label)}</span>`;
    }).join("");
  };

  const getInterviewCountdown = (scheduledAtRaw) => {
    const scheduledAt = new Date(scheduledAtRaw);
    if (Number.isNaN(scheduledAt.valueOf())) {
      return { label: "Time TBD", tone: "muted" };
    }

    const now = Date.now();
    const diffMs = scheduledAt.getTime() - now;
    const diffMinutes = Math.round(diffMs / (60 * 1000));

    if (diffMinutes < -30) {
      return { label: "Already started", tone: "past" };
    }

    if (diffMinutes <= 60) {
      if (diffMinutes <= 0) {
        return { label: "Starting now", tone: "soon" };
      }
      return { label: `Starts in ${diffMinutes} min`, tone: "soon" };
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) {
      return { label: `Starts in ${diffHours} hr`, tone: "upcoming" };
    }

    const diffDays = Math.round(diffHours / 24);
    return { label: `Starts in ${diffDays} day${diffDays === 1 ? "" : "s"}`, tone: "upcoming" };
  };

  const readSentInterviewReminders = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(INTERVIEW_REMINDER_KEY) || "{}");
      if (!parsed || typeof parsed !== "object") return {};
      return parsed;
    } catch (_err) {
      return {};
    }
  };

  const getDefaultReminderSettings = () => ({ enabled: true, leadMinutes: 30 });

  const readReminderSettings = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(INTERVIEW_REMINDER_SETTINGS_KEY) || "null");
      const defaults = getDefaultReminderSettings();
      const lead = Number(parsed?.leadMinutes || defaults.leadMinutes);
      const leadMinutes = [10, 30, 60].includes(lead) ? lead : defaults.leadMinutes;
      return {
        enabled: parsed?.enabled !== false,
        leadMinutes
      };
    } catch (_err) {
      return getDefaultReminderSettings();
    }
  };

  const writeReminderSettings = (settings) => {
    const safe = {
      enabled: settings?.enabled !== false,
      leadMinutes: [10, 30, 60].includes(Number(settings?.leadMinutes)) ? Number(settings.leadMinutes) : 30
    };
    try {
      localStorage.setItem(INTERVIEW_REMINDER_SETTINGS_KEY, JSON.stringify(safe));
    } catch (_err) {
      // ignore storage failures
    }
    return safe;
  };

  const applyReminderSettingsToUi = (settings) => {
    if (interviewReminderEnabledInput) {
      interviewReminderEnabledInput.checked = settings.enabled;
    }
    if (interviewReminderLeadTimeInput) {
      interviewReminderLeadTimeInput.value = String(settings.leadMinutes);
      interviewReminderLeadTimeInput.disabled = !settings.enabled;
    }
  };

  const writeSentInterviewReminders = (value) => {
    try {
      localStorage.setItem(INTERVIEW_REMINDER_KEY, JSON.stringify(value || {}));
    } catch (_err) {
      // ignore storage failures
    }
  };

  const pruneInterviewReminderState = (state) => {
    const now = Date.now();
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    const next = {};
    Object.entries(state || {}).forEach(([key, sentAt]) => {
      const ts = Number(sentAt || 0);
      if (Number.isFinite(ts) && now - ts < maxAgeMs) {
        next[key] = ts;
      }
    });
    return next;
  };

  const triggerInterviewReminders = (rows) => {
    const settings = readReminderSettings();
    if (!settings.enabled) return;

    const interviews = Array.isArray(rows) ? rows : [];
    if (!interviews.length) return;

    const now = Date.now();
    const leadMinutes = Number(settings.leadMinutes || 30);
    const inLeadWindowMs = leadMinutes * 60 * 1000;
    const sent = pruneInterviewReminderState(readSentInterviewReminders());
    let changed = false;

    interviews.forEach((row) => {
      const status = String(row?.status || "scheduled").toLowerCase();
      if (!["scheduled"].includes(status)) return;

      const startAt = new Date(row?.scheduled_at || "");
      if (Number.isNaN(startAt.valueOf())) return;

      const diff = startAt.getTime() - now;
      if (diff < 0 || diff > inLeadWindowMs) return;

      const reminderId = String(row?.id || "");
      if (!reminderId) return;
      if (sent[reminderId]) return;

      const minutes = Math.max(1, Math.round(diff / (60 * 1000)));
      const title = row?.job_title ? ` for ${row.job_title}` : "";
      const message = `Interview${title} starts in ${minutes} minute${minutes === 1 ? "" : "s"}.`;

      if (typeof window.toast === "function") {
        window.toast(message);
      }

      sent[reminderId] = now;
      changed = true;
    });

    if (changed) {
      writeSentInterviewReminders(sent);
    }
  };

  const isBackgroundCheckOverdue = (row) => {
    const status = String(row?.status || "pending").toLowerCase();
    if (!["pending", "in_progress"].includes(status)) return false;

    const startRef = row?.ordered_at || row?.created_at;
    const startedAt = new Date(startRef);
    if (Number.isNaN(startedAt.valueOf())) return false;

    const elapsedMs = Date.now() - startedAt.getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    return elapsedMs > sevenDaysMs;
  };

  const renderMyInterviews = (rows) => {
    if (!myInterviewsContainer) return;

    if (!rows.length) {
      myInterviewsContainer.innerHTML = '<p class="empty-state">No interviews scheduled yet.</p>';
      return;
    }

    myInterviewsContainer.innerHTML = "";
    rows.forEach((row) => {
      const status = String(row.status || "scheduled").toLowerCase();
      const when = formatInterviewDateTime(row.scheduled_at);
      const meetingType = String(row.meeting_type || "video").replace(/_/g, " ");
      const duration = Number(row.duration_minutes || 30);
      const notes = row.notes ? `<p class="p-muted">${esc(row.notes)}</p>` : "";
      const calendarUrls = buildInterviewCalendarUrls(row);
      const countdown = getInterviewCountdown(row.scheduled_at);
      const meetingTypeIcon = meetingType.includes("phone")
        ? "fa-phone"
        : meetingType.includes("onsite")
          ? "fa-building"
          : "fa-video";

      myInterviewsContainer.innerHTML += `
        <article class="app-card">
          <div class="app-card__header">
            <div>
              <h3>${esc(row.job_title || "Interview")}</h3>
              <p class="meta">${esc(row.job_location || "")}${row.job_location ? " • " : ""}<i class="fa-solid ${meetingTypeIcon}" aria-hidden="true"></i> ${esc(meetingType)}</p>
              <p class="meta">${esc(when)} • ${esc(String(duration))} mins</p>
              <p class="meta">With: ${esc(row.employer_name || "Employer")}</p>
            </div>
            <div class="status-stack">
              <span class="status-pill status-${status}">${esc(status.replace(/_/g, " "))}</span>
              <span class="interview-countdown-badge tone-${countdown.tone}">${esc(countdown.label)}</span>
            </div>
          </div>
          ${notes}
          <div class="app-card__footer">
            <span class="meta">Meeting link: ${row.meeting_link ? `<a href="${esc(row.meeting_link)}" target="_blank" rel="noopener">Open</a>` : "Not provided"}</span>
            <div class="actions interview-action-group">
              <button class="btn btn-outline" type="button" data-action="download-ics" data-interview-id="${row.id}"><i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i> ICS</button>
              <button class="btn btn-outline" type="button" data-action="copy-invite-link" data-interview-id="${row.id}"><i class="fa-solid fa-link" aria-hidden="true"></i> Copy Invite</button>
              <a class="btn btn-outline" href="${calendarUrls.google}" target="_blank" rel="noopener" data-action="open-google"><i class="fa-brands fa-google" aria-hidden="true"></i> Google</a>
              <a class="btn btn-outline" href="${calendarUrls.outlook}" target="_blank" rel="noopener" data-action="open-outlook"><i class="fa-brands fa-microsoft" aria-hidden="true"></i> Outlook</a>
            </div>
          </div>
        </article>
      `;
    });
  };

  const renderMyBackgroundChecks = (rows) => {
    if (!myBackgroundChecksContainer) return;

    if (!rows.length) {
      myBackgroundChecksContainer.innerHTML = '<p class="empty-state">No background checks found.</p>';
      return;
    }

    myBackgroundChecksContainer.innerHTML = "";
    rows.forEach((row) => {
      const status = String(row.status || "pending").toLowerCase();
      const orderedAt = row.ordered_at ? new Date(row.ordered_at).toLocaleString() : "-";
      const completedAt = row.completed_at ? new Date(row.completed_at).toLocaleString() : "-";
      const timeline = renderBackgroundStatusTimeline(status);
      const overdue = isBackgroundCheckOverdue(row);

      myBackgroundChecksContainer.innerHTML += `
        <article class="app-card ${overdue ? "is-overdue" : ""}">
          <div class="app-card__header">
            <div>
              <h3>${esc(row.job_title || "Background check")}</h3>
              <p class="meta">Provider: ${esc(row.provider || "internal")} • Package: ${esc(row.package_name || "standard")}</p>
              <p class="meta">Ordered: ${esc(orderedAt)}${completedAt !== "-" ? ` • Completed: ${esc(completedAt)}` : ""}</p>
              <p class="meta">By: ${esc(row.employer_name || "Employer")}</p>
            </div>
            <div class="status-stack">
              <span class="status-pill status-${status}">${esc(status.replace(/_/g, " "))}</span>
              ${overdue ? '<span class="bg-check-overdue">Overdue</span>' : ""}
            </div>
          </div>
          <div class="bg-check-stage-row">${timeline}</div>
          ${row.reference_code ? `<p class="meta">Reference: ${esc(row.reference_code)}</p>` : ""}
          ${row.result_summary ? `<p class="p-muted">${esc(row.result_summary)}</p>` : ""}
        </article>
      `;
    });
  };

  const loadMyInterviews = async () => {
    if (!myInterviewsContainer) return;
    try {
      const res = await authFetch(`${API}/applications/interviews/my`);
      const data = await readResponsePayload(res);
      if (!res.ok) {
        myInterviewsContainer.innerHTML = '<p class="empty-state">Failed to load interviews.</p>';
        return;
      }
      myInterviews = Array.isArray(data) ? data : [];
      renderMyInterviews(data || []);
      triggerInterviewReminders(myInterviews);

      if (!interviewCountdownTicker) {
        interviewCountdownTicker = window.setInterval(() => {
          if (!myInterviewsContainer || !myInterviews.length) return;
          renderMyInterviews(myInterviews);
          triggerInterviewReminders(myInterviews);
        }, 60 * 1000);
      }
    } catch (err) {
      console.error(err);
      myInterviewsContainer.innerHTML = '<p class="empty-state">Server error loading interviews.</p>';
    }
  };

  const loadMyBackgroundChecks = async () => {
    if (!myBackgroundChecksContainer) return;
    try {
      const res = await authFetch(`${API}/applications/background-checks/my`);
      const data = await readResponsePayload(res);
      if (!res.ok) {
        myBackgroundChecksContainer.innerHTML = '<p class="empty-state">Failed to load background checks.</p>';
        return;
      }
      renderMyBackgroundChecks(data || []);
    } catch (err) {
      console.error(err);
      myBackgroundChecksContainer.innerHTML = '<p class="empty-state">Server error loading background checks.</p>';
    }
  };

  const downloadInterviewIcs = async (interviewId) => {
    try {
      const res = await authFetch(`${API}/applications/interviews/${interviewId}/ics`, { method: "GET" });
      if (!res.ok) {
        const payload = await readResponsePayload(res);
        alert(payload?.message || "Failed to download ICS file");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `interview-${interviewId}.ics`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert("Failed to download ICS file");
    }
  };

  const copyInterviewInviteLink = async (interviewId) => {
    const row = myInterviews.find((item) => String(item.id) === String(interviewId));
    const link = String(row?.meeting_link || "").trim();
    if (!link) {
      alert("No meeting link is available for this interview");
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      if (typeof window.toast === "function") {
        window.toast("Invite link copied");
      } else {
        alert("Invite link copied");
      }
    } catch (_err) {
      const fallback = document.createElement("textarea");
      fallback.value = link;
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
      alert("Invite link copied");
    }
  };

  const loadReferralRewards = async () => {
    if (!referralRewardsEarned || !referralRewardsPaid || !referralRewardsPending) return;
    try {
      const res = await authFetch(`${API}/referrals/rewards`);
      const payload = await readResponsePayload(res);
      if (!res.ok) return;

      referralRewardsEarned.textContent = formatCentsToUsd(payload.total_earned_cents || 0);
      referralRewardsPaid.textContent = formatCentsToUsd(payload.total_paid_cents || 0);
      referralRewardsPending.textContent = formatCentsToUsd(payload.total_pending_cents || 0);
    } catch (err) {
      console.error(err);
    }
  };

  const loadReferrals = async () => {
    if (!referralsList) return;
    try {
      const res = await authFetch(`${API}/referrals/my-referrals`);
      const payload = await readResponsePayload(res);
      if (!res.ok) {
        referralsList.innerHTML = "<p class=\"empty-state\">Failed to load referrals.</p>";
        return;
      }

      renderReferralRows(payload || []);
    } catch (err) {
      console.error(err);
      referralsList.innerHTML = "<p class=\"empty-state\">Server error.</p>";
    }
  };

  const initDashboard = async () => {
    await Promise.all([
      loadApplications(),
      loadShiftAlerts(),
      loadJobAlerts(),
      loadSavedJobs(),
      loadAlerts(),
      loadReferrals(),
      loadReferralRewards(),
      loadMyInterviews(),
      loadMyBackgroundChecks(),
      loadRecommendations()
    ]).catch((err) => {
      console.error("Dashboard initialization error:", err);
    });
  };

  initDashboard();

  savedContainer?.addEventListener("click", async (event) => {
    const button = event.target.closest(".save-btn");
    if (!button) return;

    const jobId = button.getAttribute("data-save-id");
    if (!jobId) return;

    try {
      const res = await authFetch(`${API}/saved-jobs/${jobId}`, {
        method: "DELETE"
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "Failed to remove saved job");
        return;
      }

      await loadSavedJobs();
    } catch (err) {
      console.error(err);
      alert("Failed to remove saved job");
    }
  });

  container?.addEventListener("click", async (event) => {
    const action = event.target.getAttribute("data-action");
    const jobId = event.target.getAttribute("data-job-id");
    if (action !== "worker-confirm" || !jobId) return;

    try {
      const res = await authFetch(`${API}/shifts/${jobId}/worker-confirm`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "Failed to confirm shift");
        return;
      }
      alert(data.message || "Shift confirmed");
      const refresh = await authFetch(`${API}/applications/my`);
      allApps = await refresh.json();
      setStats(allApps);
      applyFilters();
    } catch (err) {
      console.error(err);
      alert("Failed to confirm shift");
    }
  });

  alertForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const resolvedCategory = resolveAlertCategoryPayload();
    if (resolvedCategory.category.toLowerCase() === "other" && !resolvedCategory.category_custom) {
      alert("Please enter a custom category");
      alertCategoryCustomInput?.focus();
      return;
    }

    const payload = {
      keyword: document.getElementById("alertKeyword").value.trim(),
      location: document.getElementById("alertLocation").value.trim(),
      category: resolvedCategory.category,
      category_custom: resolvedCategory.category_custom,
      job_type: document.getElementById("alertType").value.trim(),
      frequency: document.getElementById("alertFrequency").value
    };

    try {
      const { res, data } = await requestAlertApi(`${API}/job-alerts`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        showError(data?.message || data?.error || `Failed to create alert (HTTP ${res.status})`);
        return;
      }

      alertForm.reset();
      await loadAlerts();
    } catch (err) {
      console.error(err);
      alert(err?.message === "Failed to fetch"
        ? "Network issue while creating alert. Make sure backend is running on port 3000."
        : "Failed to create alert");
    }
  });

  alertsList?.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("button[data-action][data-id]");
    if (!actionButton) return;

    const action = actionButton.getAttribute("data-action");
    const alertId = actionButton.getAttribute("data-id");
    if (!action || !alertId) return;

    const selected = alerts.find(item => String(item.id) === String(alertId));
    if (!selected) return;

    if (action === "delete") {
      try {
        const { res, data } = await requestAlertApi(`${API}/job-alerts/${alertId}`, {
          method: "DELETE"
        });
        if (!res.ok) {
          showError(data?.message || data?.error || `Failed to delete alert (HTTP ${res.status})`);
          return;
        }
        await loadAlerts();
      } catch (err) {
        console.error(err);
        alert("Failed to delete alert");
      }
      return;
    }

    if (action === "toggle") {
      const payload = {
        keyword: selected.keyword || "",
        location: selected.location || "",
        category: selected.category || "",
        job_type: selected.job_type || "",
        frequency: selected.frequency || "daily",
        is_active: selected.is_active ? 0 : 1
      };

      try {
        const { res, data } = await requestAlertApi(`${API}/job-alerts/${alertId}`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          showError(data?.message || data?.error || `Failed to update alert (HTTP ${res.status})`);
          return;
        }
        await loadAlerts();
      } catch (err) {
        console.error(err);
        alert("Failed to update alert");
      }
    }
  });

  refreshShiftAlerts?.addEventListener("click", loadShiftAlerts);

createShiftAlertBtn?.addEventListener("click", () => {
    const panel = document.getElementById("alerts-panel");
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });

    if (alertTypeInput) alertTypeInput.value = "Shift";
    if (alertFrequencyInput) alertFrequencyInput.value = "daily";
    if (alertCategoryInput && !alertCategoryInput.value) alertCategoryInput.value = "";
    if (alertKeywordInput && !alertKeywordInput.value) alertKeywordInput.focus();

    // Explain flow so users know this opens configurable shift alert options.
    setTimeout(() => {
      alert("Set your shift alert options below (keyword, location, and frequency), then click Create alert.");
      if (alertKeywordInput && !alertKeywordInput.value) {
        alertKeywordInput.focus();
      } else if (alertLocationInput && !alertLocationInput.value) {
        alertLocationInput.focus();
      }
    }, 100);
  });

  shiftAlertRules?.addEventListener("click", async (event) => {
    const action = event.target.getAttribute("data-action");
    const alertId = event.target.getAttribute("data-id");
    if (!action || !alertId) return;

    const selected = alerts.find(item => String(item.id) === String(alertId));
    if (!selected || !isShiftRule(selected)) return;

    if (action === "edit-shift-rule") {
      startEditingShiftRule(selected);
      return;
    }

    if (action === "delete-shift-rule") {
      try {
        const res = await authFetch(`${API}/job-alerts/${alertId}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || "Failed to delete shift alert");
          return;
        }
        await loadAlerts();
        await loadShiftAlerts();
      } catch (err) {
        console.error(err);
        alert("Failed to delete shift alert");
      }
      return;
    }

    if (action === "toggle-shift-rule") {
      try {
        const res = await authFetch(`${API}/job-alerts/${alertId}`, {
          method: "PUT",
          body: JSON.stringify({
            keyword: selected.keyword || "",
            location: selected.location || "",
            category: selected.category || "",
            job_type: "Shift",
            frequency: selected.frequency || "daily",
            is_active: selected.is_active ? 0 : 1
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || "Failed to update shift alert");
          return;
        }
        await loadAlerts();
      } catch (err) {
        console.error(err);
        alert("Failed to update shift alert");
      }
    }
  });

  shiftAlertsList?.addEventListener("click", async (event) => {
    const action = event.target.getAttribute("data-action");
    const id = event.target.getAttribute("data-id");
    if (action !== "read" || !id) return;

    try {
      const res = await authFetch(`${API}/job-alerts/shift-notifications/${id}/read`, {
        method: "PUT"
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "Failed to mark read");
        return;
      }
      await loadShiftAlerts();
    } catch (err) {
      console.error(err);
      alert("Failed to mark read");
    }
  });

  alertCategoryInput?.addEventListener("change", syncAlertCustomCategoryField);
  syncAlertCustomCategoryField();

  referralForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = (referralEmailInput?.value || "").trim();
    if (!email) {
      alert("Referral email is required");
      referralEmailInput?.focus();
      return;
    }

    const payload = {
      referred_name: (referralNameInput?.value || "").trim(),
      referred_email: email,
      note: (referralNoteInput?.value || "").trim()
    };

    try {
      const res = await authFetch(`${API}/referrals/create`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      const data = await readResponsePayload(res);
      if (!res.ok) {
        alert(data?.message || "Failed to create referral");
        return;
      }

      referralForm.reset();
      await loadReferrals();
      await loadReferralRewards();
      alert("Referral created successfully");
    } catch (err) {
      console.error(err);
      alert("Failed to create referral");
    }
  });
});
