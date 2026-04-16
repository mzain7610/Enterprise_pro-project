document.addEventListener("DOMContentLoaded", async () => {
    // --- Real-time updates via Socket.io ---
    async function loadSocketIoClient() {
      if (window.io) return window.io;
      return new Promise((resolve, reject) => {
        const existing = document.getElementById("socketIoClientScript");
        if (existing) {
          existing.addEventListener("load", () => resolve(window.io), { once: true });
          existing.addEventListener("error", reject, { once: true });
          return;
        }
        const script = document.createElement("script");
        script.id = "socketIoClientScript";
        script.src = `${API.replace(/\/api$/, "")}/socket.io/socket.io.js`;
        script.onload = () => resolve(window.io);
        script.onerror = () => reject(new Error("Failed to load realtime client"));
        document.head.appendChild(script);
      });
    }

    async function connectEmployerRealtime() {
      try {
        const ioFactory = await loadSocketIoClient();
        if (!ioFactory) return;
        const socket = ioFactory(API.replace(/\/api$/, ""), {
          transports: ["websocket", "polling"],
          auth: { token }
        });
        socket.on("connect", () => {
          // console.log("Employer realtime connected");
        });
        socket.on("employer:application-updated", () => {
          // Reload pipeline and notifications
          loadApplications();
          loadApplicationNotifications();
        });
        socket.on("employer:stats-updated", () => {
          loadStats();
        });
        // Optionally, listen for other events as needed
      } catch (err) {
        // console.error("Failed to connect employer realtime:", err);
      }
    }

  const token = localStorage.getItem("token");
  if (!token) {
    showWarning("Login required");
    window.location.href = "login.html";
    return;
  }

  const rawUser = localStorage.getItem("user");
  let user = {};
  if (rawUser) {
    try {
      user = JSON.parse(rawUser) || {};
    } catch (err) {
      console.error("Invalid JSON in localStorage.user", err);
      localStorage.removeItem("user");
      user = {};
    }
  }

  // Only employers and admins can access this page
  if (!user.is_admin && user.role !== "employer") {
    showError("This page is for employers only.");
    window.location.href = "dashboard.html";
    return;
  }
  const jobSelect = document.getElementById("jobSelect");
  const refreshJobs = document.getElementById("refreshJobs");
  const renewJobBtn = document.getElementById("renewJobBtn");
  const reboostJobBtn = document.getElementById("reboostJobBtn");
  const markNotificationsReadBtn = document.getElementById("markNotificationsReadBtn");
  const selectedJobMeta = document.getElementById("selectedJobMeta");
  const applicationNotificationMeta = document.getElementById("applicationNotificationMeta");
  const applicationNotificationBadge = document.getElementById("applicationNotificationBadge");
  const applicationNotificationFilters = document.getElementById("applicationNotificationFilters");
  const applicationNotificationsList = document.getElementById("applicationNotificationsList");
  const jobHistoryMeta = document.getElementById("jobHistoryMeta");
  const jobHistoryList = document.getElementById("jobHistoryList");
  const refreshMessages = document.getElementById("refreshMessages");
  const messageMeta = document.getElementById("messageMeta");
  const messageList = document.getElementById("messageList");
  const messageForm = document.getElementById("messageForm");
  const messageInput = document.getElementById("messageInput");
  const candidateProfile = document.getElementById("candidateProfile");
  const statJobs = document.getElementById("employerTotalJobs");
  const statApplications = document.getElementById("employerTotalApplications");
  const statSaves = document.getElementById("employerTotalSaves");
  const pipelineSummary = document.getElementById("pipelineSummary");
  const bulkCsvFile = document.getElementById("bulkCsvFile");
  const bulkCsvMeta = document.getElementById("bulkCsvMeta");
  const bulkDryRunBtn = document.getElementById("bulkDryRunBtn");
  const bulkUploadBtn = document.getElementById("bulkUploadBtn");
  const bulkUploadResult = document.getElementById("bulkUploadResult");
  const bulkUploadIssues = document.getElementById("bulkUploadIssues");
  const downloadBulkTemplateBtn = document.getElementById("downloadBulkTemplateBtn");

  const stages = ["new", "screening", "interview", "offer", "hired", "rejected"];
  const interviewStatuses = ["not_started", "scheduled", "completed", "offered", "rejected"];
  const formatInterviewStatus = (value) => String(value || "not_started").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  let applications = [];
  let filteredApplications = [];
  let activeApplicationId = null;
  let employerJobsById = new Map();
  let parsedBulkRows = [];
  let notificationFilter = "unread";
  let selectedApplicationIds = new Set();
  let applicationTags = {};
  let applicationShortlist = {};
  let filterStage = "";
  let searchQuery = "";
  let sortKey = "created_at_desc";
  const APP_NOTIFICATION_KEY = `employerAppsSeen.${String(user.id || "anon")}`;

  const readSeenApplicationState = () => {
    try {
      const raw = localStorage.getItem(APP_NOTIFICATION_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_err) {
      return {};
    }
  };

  const writeSeenApplicationState = (state) => {
    try {
      localStorage.setItem(APP_NOTIFICATION_KEY, JSON.stringify(state || {}));
    } catch (_err) {
      // ignore storage write errors
    }
  };

  const safeAuthFetch = window.authFetch
    ? window.authFetch
    : (url, options = {}) => {
        return fetch(url, {
          ...options,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          }
        });
      };

  const splitCsvLine = (line) => {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];

      if (char === '"') {
        const next = line[i + 1];
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
        continue;
      }

      current += char;
    }

    values.push(current);
    return values.map((v) => v.trim());
  };

  const parseBulkCsv = (csvText) => {
    const lines = String(csvText || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length < 2) return [];

    const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
    const rows = [];

    for (let i = 1; i < lines.length; i += 1) {
      const cols = splitCsvLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => {
        row[h] = cols[idx] ?? "";
      });
      rows.push(row);
    }

    return rows;
  };

  const renderBulkIssues = (issues) => {
    if (!bulkUploadIssues) return;
    if (!issues || !issues.length) {
      bulkUploadIssues.innerHTML = "";
      return;
    }

    bulkUploadIssues.innerHTML = issues
      .slice(0, 40)
      .map((issue) => {
        const line = issue.row || "?";
        const errors = Array.isArray(issue.errors)
          ? issue.errors.join(" | ")
          : (issue.error || "Unknown error");
        return `<div class=\"job-card\"><strong>Row ${line}</strong><p class=\"p-muted\">${esc(errors)}</p></div>`;
      })
      .join("");
  };

  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get("payment");
  const sessionId = params.get("session_id");
  const mode = params.get("mode");
  const paidJobId = params.get("jobId");

  if (paymentStatus === "success" && mode === "reboost" && sessionId && paidJobId) {
    try {
      const confirmRes = await safeAuthFetch(`${API}/payments/confirm`, {
        method: "POST",
        body: JSON.stringify({ sessionId, mode: "reboost", jobId: paidJobId })
      });
      const confirmData = await confirmRes.json().catch(() => ({}));
      if (!confirmRes.ok) {
        showError(confirmData.message || "Payment confirmation failed");
      } else {
        showSuccess("Job re-boosted successfully ✅");
      }
    } catch (err) {
      showError("Payment confirmation failed");
    }
    window.history.replaceState({}, document.title, "employer.html");
  }

  if (paymentStatus === "cancel" && mode === "reboost") {
    showError("Premium reboost payment was canceled.");
    window.history.replaceState({}, document.title, "employer.html");
  }

  const renderSelectedJobMeta = () => {
    if (!selectedJobMeta) return;
    const jobId = jobSelect?.value;
    if (!jobId) {
      selectedJobMeta.textContent = "";
      return;
    }

    const job = employerJobsById.get(String(jobId));
    if (!job) {
      selectedJobMeta.textContent = "";
      return;
    }

    const bits = [];
    bits.push(job.is_premium ? "Premium active" : "Standard listing");
    if (Number(job.reboost_count || 0) > 0) bits.push(`Re-boosted ${Number(job.reboost_count)}x`);
    if (job.repost_of_job_id) bits.push(`Repost of #${job.repost_of_job_id}`);
    if (job.expires_at) {
      const expDate = new Date(job.expires_at);
      if (!Number.isNaN(expDate.getTime())) {
        bits.push(`Expires ${expDate.toLocaleDateString()}`);
      }
    }
    if (Number(job.renewal_count || 0) > 0) bits.push(`Renewed ${Number(job.renewal_count)}x`);
    selectedJobMeta.textContent = bits.join(" | ");
  };

  // Fetch and render detailed job action history for the selected job
  const renderJobHistory = async (jobId) => {
    if (!jobHistoryList || !jobHistoryMeta) return;
    if (!jobId) {
      jobHistoryMeta.textContent = "Select a job to view history.";
      jobHistoryList.innerHTML = "";
      return;
    }
    jobHistoryMeta.textContent = "Loading history...";
    jobHistoryList.innerHTML = "";
    try {
      const res = await safeAuthFetch(`${API}/jobs/${jobId}/history`);
      const logs = await res.json();
      if (!res.ok || !Array.isArray(logs)) {
        jobHistoryMeta.textContent = logs.message || "Failed to load history.";
        return;
      }
      if (!logs.length) {
        jobHistoryMeta.textContent = "No actions recorded for this job yet.";
        return;
      }
      jobHistoryMeta.textContent = `${logs.length} actions recorded for this job.`;
      jobHistoryList.innerHTML = logs.map(log => {
        const who = log.user_name ? `${esc(log.user_name)} (${esc(log.user_role)})` : esc(log.user_role);
        const when = log.created_at ? new Date(log.created_at).toLocaleString() : "";
        const action = esc(log.action);
        let details = "";
        if (log.details && typeof log.details === "object") {
          details = Object.entries(log.details).map(([k, v]) => `<span class='p-muted'>${esc(k)}: ${esc(String(v))}</span>`).join(" | ");
        } else if (log.details) {
          details = `<span class='p-muted'>${esc(String(log.details))}</span>`;
        }
        return `
          <article class="job-card" style="padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
              <div>
                <p style="margin:0;font-weight:600;">${action}</p>
                <p class="p-muted" style="margin:4px 0 0;">By ${who} | ${when}</p>
                ${details ? `<p class='p-muted' style='margin:4px 0 0;'>${details}</p>` : ""}
              </div>
            </div>
          </article>
        `;
      }).join("");
    } catch (err) {
      jobHistoryMeta.textContent = "Failed to load history.";
    }
  };

  const clearPipeline = () => {
    stages.forEach(stage => {
      const column = document.getElementById(`stage-${stage}`);
      if (column) column.innerHTML = "";
    });
  };

  const getShiftPaymentButtons = () => {
    return Array.from(shiftPaymentOptions?.querySelectorAll(".payment-method-option") || []);
  };

  const getShiftPaymentLabel = (method) => {
    const labels = {
      card: "Card",
      applepay: "Apple Pay",
      gpay: "Google Pay",
      paypal: "PayPal",
      bank_transfer: "Bank Transfer"
    };
    return labels[method] || "Card";
  };

  const setShiftPaymentSelection = (method, { focus = false } = {}) => {
    const targetMethod = shiftPaymentMethods.includes(method) ? method : "card";
    const previousMethod = selectedShiftPaymentMethod;
    selectedShiftPaymentMethod = targetMethod;

    getShiftPaymentButtons().forEach((option) => {
      const isSelected = option.getAttribute("data-method") === targetMethod;
      option.classList.toggle("is-selected", isSelected);
      if (isSelected && previousMethod !== targetMethod) {
        option.classList.remove("selection-animate");
        void option.offsetWidth;
        option.classList.add("selection-animate");
      } else if (!isSelected) {
        option.classList.remove("selection-animate");
      }
      option.setAttribute("aria-selected", isSelected ? "true" : "false");
      option.setAttribute("tabindex", isSelected ? "0" : "-1");
      if (isSelected && focus) option.focus();
    });

    if (shiftPaymentSelectedText) {
      shiftPaymentSelectedText.textContent = `Selected: ${getShiftPaymentLabel(targetMethod)}`;
    }
  };

  const resolveShiftPaymentMethod = (method) => {
    if (!shiftPaymentResolver) return;
    const resolver = shiftPaymentResolver;
    shiftPaymentResolver = null;
    shiftPaymentModal?.classList.add("hidden");
    resolver(method);
  };

  const openShiftPaymentModal = () => {
    setShiftPaymentSelection("card", { focus: true });
    shiftPaymentModal?.classList.remove("hidden");
  };

  const requestShiftPaymentMethod = () => {
    return new Promise((resolve) => {
      shiftPaymentResolver = resolve;
      openShiftPaymentModal();
    });
  };

  const renderPipeline = () => {
    clearPipeline();

    if (!filteredApplications.length) {
      // Show a message in the "New" column if there are no applications for this job
      const newColumn = document.getElementById("stage-new");
      if (newColumn) {
        newColumn.innerHTML = '<div class="p-muted" style="margin:16px 0; text-align:center;">No applications for this job yet.</div>';
      }
      return;
    }

    filteredApplications.forEach(app => {
      const stage = (app.pipeline_stage || "new").toLowerCase();
      const column = document.getElementById(`stage-${stage}`) || document.getElementById("stage-new");
      if (!column) return;
      const checked = selectedApplicationIds.has(app.id) ? "checked" : "";
      const tags = (applicationTags[app.id] || []).map(t => `<span class='tag-pill bg-green-100 text-green-700' style='margin-right:4px;'>${esc(t)}</span>`).join("");
      const shortlisted = applicationShortlist[app.id] ? `<span class='tag-pill bg-yellow-100 text-yellow-700'>Shortlisted</span>` : "";
      column.innerHTML += `
        <article class="pipeline-card">
          <div class="pipeline-card__header">
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" class="bulk-app-checkbox" data-app-id="${app.id}" ${checked} />
              <h4>${esc(app.full_name || app.user_name || "Candidate")}</h4>
              <p class="meta">${esc(app.email || app.user_email || "")}</p>
            </div>
            <div class="status-stack">
              <span class="status-pill status-${stage}">${esc(stage)}</span>
              ${(function() { if (!app.is_shift) return ""; const status = (app.escrow_status || app.shift_status || "open").toLowerCase(); const label = status.replace(/_/g, " "); return `<span class="status-pill status-${status}">${label}</span>`; })()}
              ${tags}
              ${shortlisted}
            </div>
          </div>
          <p class="p-muted">Applied: ${app.created_at ? new Date(app.created_at).toLocaleDateString() : ""}</p>
          ${(function() { if (!app.is_shift) return ""; const pay = app.shift_pay_cents ? `$${(app.shift_pay_cents / 100).toFixed(2)}` : ""; const start = app.shift_start ? new Date(app.shift_start).toLocaleString() : ""; const end = app.shift_end ? new Date(app.shift_end).toLocaleString() : ""; const time = start && end ? `${start} - ${end}` : start || end; const parts = [pay, time].filter(Boolean).join(" • "); return parts ? `<div class="p-muted">${parts}</div>` : ""; })()}
          <div class="pipeline-eval-summary">
            <span class="status-pill status-screening">${esc(app.score == null ? "Not scored" : `Score ${Number(app.score)}/100`)}</span>
            <span class="status-pill status-new">${formatInterviewStatus(app.interview_status || "not_started")}</span>
          </div>
          ${app.cv_path ? `<a href="${app.cv_path}" class="btn btn-outline" target="_blank">CV</a>` : ""}
          ${(function() { if (!app.is_shift) return ""; const canAccept = !app.escrow_id && (app.shift_status || "open") === "open"; const canConfirm = app.escrow_id && app.escrow_status === "awaiting_confirmation" && !app.client_confirmed; const actions = []; if (canAccept) { actions.push(`<button class=\"btn btn-outline\" type=\"button\" data-action=\"accept-shift\" data-id=\"${app.id}\">Accept shift</button>`); } if (canConfirm) { actions.push(`<button class=\"btn btn-outline\" type=\"button\" data-action=\"client-confirm\" data-job-id=\"${app.job_id}\">Confirm completion</button>`); } return actions.length ? `<div class=\"shift-actions\">${actions.join("")}</div>` : ""; })()}
          <div class="pipeline-eval-controls">
            <input class="form-input" type="number" min="0" max="100" step="1" data-score-input="${app.id}" value="${app.score == null ? "" : Number(app.score)}" placeholder="Score 0-100">
            <select class="form-input" data-interview-status-input="${app.id}">${interviewStatuses.map((statusValue) => { const selected = String(app.interview_status || "not_started") === statusValue ? "selected" : ""; return `<option value="${statusValue}" ${selected}>${formatInterviewStatus(statusValue)}</option>`; }).join("")}</select>
            <textarea class="form-input" rows="2" data-interview-notes-input="${app.id}" placeholder="Interview notes (optional)">${esc(app.interview_notes || "")}</textarea>
          </div>
          <div class="pipeline-actions">
            <select class="form-input" data-stage-select="${app.id}">
              ${stages.map(stageName => { const selected = stageName === stage ? "selected" : ""; const label = stageName.charAt(0).toUpperCase() + stageName.slice(1); return `<option value="${stageName}" ${selected}>${label}</option>`; }).join("")}
            </select>
            <button class="btn btn-primary" type="button" data-action="save-eval" data-id="${app.id}">Save evaluation</button>
            <button class="btn btn-outline" type="button" data-action="schedule-interview" data-id="${app.id}">Schedule interview</button>
            <button class="btn btn-outline" type="button" data-action="background-check" data-id="${app.id}">Background check</button>
            <button class="btn btn-outline" type="button" data-action="move" data-id="${app.id}">Update</button>
            <button class="btn btn-outline" type="button" data-action="message" data-id="${app.id}">Message</button>
            <button class="btn btn-outline" type="button" data-action="profile" data-id="${app.id}">View profile</button>
          </div>
        </article>
      `;
    });
  };

  const renderCandidateProfile = (app) => {
    if (!candidateProfile) return;
    if (!app) {
      candidateProfile.innerHTML = '<p class="p-muted">Select a candidate to view profile.</p>';
      return;
    }

    const candidate = app.full_name || app.user_name || "Candidate";
    const email = app.email || app.user_email || "";
    const created = app.created_at ? new Date(app.created_at).toLocaleDateString() : "";
    const resume = app.cv_path
      ? `<a class="profile-link" href="${app.cv_path}" target="_blank">Resume</a>`
      : "<span class=\"p-muted\">No resume</span>";
    const shift = app.is_shift
      ? `<span class="pill">Shift</span>`
      : "";
    const evalScore = app.score == null ? "Not scored" : `${Number(app.score)}/100`;
    const interviewStatus = formatInterviewStatus(app.interview_status || "not_started");
    const notes = app.interview_notes ? `<p class="p-muted" style="margin-top:8px;">${esc(app.interview_notes)}</p>` : "";

    candidateProfile.innerHTML = `
      <div class="candidate-head">
        <div class="profile-avatar">${esc(candidate.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "?")}</div>
        <div>
          <h4>${esc(candidate)}</h4>
          <p class="p-muted">${esc(email)}</p>
        </div>
      </div>
      <div class="candidate-meta">
        <span class="p-muted">Applied: ${created}</span>
        ${shift}
      </div>
      <div class="candidate-meta">
        <span class="p-muted">Score: ${esc(evalScore)}</span>
        <span class="p-muted">Interview: ${esc(interviewStatus)}</span>
      </div>
      ${notes}
      <div class="candidate-actions">
        ${resume}
      </div>
    `;
  };

  const loadJobs = async () => {
    try {
      const res = await safeAuthFetch(`${API}/employer/jobs`);
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to load jobs");
        return;
      }

      jobSelect.innerHTML = "";
      if (!data.length) {
        jobSelect.innerHTML = '<option value="">No jobs found</option>';
        clearPipeline();
        renderJobHistory(null);
        return;
      }

      data.forEach(job => {
        const option = document.createElement("option");
        option.value = job.id;
        option.textContent = `${job.title} (${job.location || ""})`;
        jobSelect.appendChild(option);
      });

      employerJobsById = new Map((data || []).map((job) => [String(job.id), job]));
      renderJobHistory(jobSelect.value);
      renderSelectedJobMeta();
      loadApplicationNotifications();

      await loadApplications();
    } catch (err) {
      console.error(err);
      showError("Failed to load jobs");
    }
  };

  const filterAndSortApplications = () => {
    let result = [...applications];
    // Filter by stage
    if (filterStage) {
      result = result.filter(app => (app.pipeline_stage || "new") === filterStage);
    }
    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(app =>
        (app.full_name || app.user_name || "").toLowerCase().includes(q) ||
        (app.email || app.user_email || "").toLowerCase().includes(q) ||
        (applicationTags[app.id] || []).some(tag => tag.toLowerCase().includes(q))
      );
    }
    // Sort
    result.sort((a, b) => {
      switch (sortKey) {
        case "created_at_asc": return new Date(a.created_at) - new Date(b.created_at);
        case "created_at_desc": return new Date(b.created_at) - new Date(a.created_at);
        case "score_desc": return (b.score || 0) - (a.score || 0);
        case "score_asc": return (a.score || 0) - (b.score || 0);
        case "name_asc": return (a.full_name || a.user_name || "").localeCompare(b.full_name || b.user_name || "");
        case "name_desc": return (b.full_name || b.user_name || "").localeCompare(a.full_name || a.user_name || "");
        default: return 0;
      }
    });
    filteredApplications = result;
  };

  const loadApplications = async () => {
    const jobId = jobSelect.value;
    if (!jobId) {
      clearPipeline();
      return;
    }

    try {
      const res = await safeAuthFetch(`${API}/employer/applications?jobId=${jobId}`);
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to load applications");
        return;
      }

      applications = data || [];
      selectedApplicationIds = new Set();
      applicationTags = {};
      applicationShortlist = {};

      // Fetch tags and shortlist for each application
      await Promise.all(applications.map(async (app) => {
        // Tags
        try {
          const tagRes = await safeAuthFetch(`${API}/employer/applications/${app.id}/tags`);
          if (tagRes.ok) {
            applicationTags[app.id] = await tagRes.json();
          }
        } catch {}
        // Shortlist
        try {
          const shortlistRes = await safeAuthFetch(`${API}/employer/applications/${app.id}/shortlist`);
          if (shortlistRes.ok) {
            const shortlistData = await shortlistRes.json();
            applicationShortlist[app.id] = !!shortlistData.shortlisted;
          }
        } catch {}
      }));

      filterAndSortApplications();
      renderPipeline();

      const seenState = readSeenApplicationState();
      const currentCount = applications.length;
      const previousCount = Number(seenState[jobId] || 0);
      if (currentCount > previousCount) {
        const delta = currentCount - previousCount;
        if (typeof toast === "function") {
          toast(`${delta} new application${delta > 1 ? "s" : ""} received for this job.`);
        } else if (messageMeta) {
          messageMeta.textContent = `${delta} new application${delta > 1 ? "s" : ""} just received.`;
        }
      }
      seenState[jobId] = currentCount;
      writeSeenApplicationState(seenState);
    } catch (err) {
      console.error(err);
      showError("Failed to load applications");
    }
  };

  // UI event listeners for advanced controls
  document.getElementById("applicationFilterStage")?.addEventListener("change", (e) => {
    filterStage = e.target.value;
    filterAndSortApplications();
    renderPipeline();
  });
  document.getElementById("applicationSearch")?.addEventListener("input", (e) => {
    searchQuery = e.target.value;
    filterAndSortApplications();
    renderPipeline();
  });
  document.getElementById("applicationSort")?.addEventListener("change", (e) => {
    sortKey = e.target.value;
    filterAndSortApplications();
    renderPipeline();
  });

  // Bulk selection
  document.addEventListener("change", (e) => {
    if (e.target.classList.contains("bulk-app-checkbox")) {
      const appId = Number(e.target.dataset.appId);
      if (e.target.checked) {
        selectedApplicationIds.add(appId);
      } else {
        selectedApplicationIds.delete(appId);
      }
    }
  });

  // Bulk actions (demo: tagging, shortlisting, export, move stage, message)
  document.getElementById("bulkTagBtn")?.addEventListener("click", async () => {
    if (!selectedApplicationIds.size) return showWarning("Select applications first");
    const tag = prompt("Enter tag to add to selected:");
    if (!tag) return;
    await Promise.all(Array.from(selectedApplicationIds).map(async (id) => {
      try {
        const res = await safeAuthFetch(`${API}/employer/applications/${id}/tags`, {
          method: "POST",
          body: JSON.stringify({ tag })
        });
        if (res.ok) {
          if (!applicationTags[id]) applicationTags[id] = [];
          if (!applicationTags[id].includes(tag)) applicationTags[id].push(tag);
        }
      } catch {}
    }));
    renderPipeline();
  });
  document.getElementById("bulkShortlistBtn")?.addEventListener("click", async () => {
    if (!selectedApplicationIds.size) return showWarning("Select applications first");
    await Promise.all(Array.from(selectedApplicationIds).map(async (id) => {
      try {
        const res = await safeAuthFetch(`${API}/employer/applications/${id}/shortlist`, {
          method: "PUT",
          body: JSON.stringify({ shortlisted: true })
        });
        if (res.ok) applicationShortlist[id] = true;
      } catch {}
    }));
    renderPipeline();
  });
  document.getElementById("bulkExportBtn")?.addEventListener("click", () => {
    if (!selectedApplicationIds.size) return showWarning("Select applications first");
    const rows = applications.filter(app => selectedApplicationIds.has(app.id)).map(app => [
      app.full_name || app.user_name || "",
      app.email || app.user_email || "",
      app.pipeline_stage || "",
      app.score == null ? "" : app.score,
      (applicationTags[app.id] || []).join(";"),
      applicationShortlist[app.id] ? "Yes" : "No"
    ]);
    const csv = ["Name,Email,Stage,Score,Tags,Shortlisted"].concat(rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "applications-export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });
  document.getElementById("bulkMoveStageBtn")?.addEventListener("click", () => {
    if (!selectedApplicationIds.size) return showWarning("Select applications first");
    const stage = prompt("Enter stage (new, screening, interview, offer, hired, rejected):");
    if (!stage || !stages.includes(stage)) return showWarning("Invalid stage");
    // In real impl, send to backend. Here, update locally for demo:
    applications.forEach(app => {
      if (selectedApplicationIds.has(app.id)) app.pipeline_stage = stage;
    });
    filterAndSortApplications();
    renderPipeline();
  });
  document.getElementById("bulkMessageBtn")?.addEventListener("click", () => {
    if (!selectedApplicationIds.size) return showWarning("Select applications first");
    const msg = prompt("Enter message to send to selected candidates:");
    if (!msg) return;
    showSuccess(`Message sent to ${selectedApplicationIds.size} candidates (demo only)`);
  });

  const loadMessages = async (applicationId) => {
    if (!applicationId) return;

    try {
      const res = await safeAuthFetch(`${API}/messages/applications/${applicationId}/messages`);
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to load messages");
        return;
      }

      messageList.innerHTML = "";
      if (!data.length) {
        messageList.innerHTML = '<p class="p-muted">No messages yet.</p>';
        return;
      }

      data.forEach(msg => {
        const isMe = user && msg.sender_id === user.id;
        const bubbleClass = isMe ? "message-bubble me" : "message-bubble";
        const label = isMe ? "You" : "Candidate";
        const time = msg.created_at ? new Date(msg.created_at).toLocaleString() : "";

        messageList.innerHTML += `
          <div class="${bubbleClass}">
            <div class="message-meta">${esc(label)} • ${esc(time)}</div>
            <div>${esc(msg.message)}</div>
          </div>
        `;
      });
    } catch (err) {
      console.error(err);
      showError("Failed to load messages");
    }
  };

  const renderPipelineSummary = (data) => {
    if (!pipelineSummary) return;
    const total = data.reduce((sum, row) => sum + row.count, 0) || 1;

    const rows = stages.map((stage) => {
      const match = data.find((row) => row.stage === stage);
      const count = match ? match.count : 0;
      const percent = Math.round((count / total) * 100);
      const label = stage.charAt(0).toUpperCase() + stage.slice(1);

      return `
        <div class="pipeline-bar">
          <span class="pipeline-bar__label">${label}</span>
          <div class="pipeline-bar__track">
            <div class="pipeline-bar__fill" style="width:${percent}%"></div>
          </div>
          <span class="pipeline-bar__count">${count}</span>
        </div>
      `;
    });

    pipelineSummary.innerHTML = rows.join("");
  };

  const loadStats = async () => {
    try {
      const res = await safeAuthFetch(`${API}/employer/stats`);
      const data = await res.json();
      if (!res.ok) {
        console.warn(data.message || "Failed to load employer stats");
        return;
      }

      if (statJobs) statJobs.textContent = data.totalJobs || 0;
      if (statApplications) statApplications.textContent = data.totalApplications || 0;
      if (statSaves) statSaves.textContent = data.totalSaves || 0;
      renderPipelineSummary(data.pipeline || []);
    } catch (err) {
      console.error(err);
    }
  };

  const renderApplicationNotificationsMeta = (unread, items) => {
    if (!applicationNotificationMeta) return;
    const count = Number(unread || 0);
    if (applicationNotificationBadge) {
      applicationNotificationBadge.style.display = count > 0 ? "inline-flex" : "none";
      applicationNotificationBadge.textContent = `${count} unread`;
    }
    if (markNotificationsReadBtn) {
      markNotificationsReadBtn.textContent = count > 0 ? `Mark alerts as read (${count})` : "Mark alerts as read";
    }
    if (count <= 0) {
      applicationNotificationMeta.textContent = "No new application alerts.";
      if (applicationNotificationsList) {
        applicationNotificationsList.innerHTML = "";
      }
      return;
    }

    const latest = Array.isArray(items) && items.length ? items[0] : null;
    const latestText = latest?.message ? ` Latest: ${latest.message}.` : "";
    applicationNotificationMeta.textContent = `${count} unread application alert${count > 1 ? "s" : ""}.${latestText}`;

    if (!applicationNotificationsList) return;

    const allItems = Array.isArray(items) ? items : [];
    const filteredItems = allItems.filter((item) => {
      const isRead = Number(item.is_read) === 1;
      if (notificationFilter === "read") return isRead;
      if (notificationFilter === "all") return true;
      return !isRead;
    }).slice(0, 8);

    if (!filteredItems.length) {
      applicationNotificationsList.innerHTML = '<p class="p-muted" style="margin:8px 0;">No alerts for this filter.</p>';
      return;
    }

    applicationNotificationsList.innerHTML = filteredItems
      .map((item) => {
        const createdAt = item.created_at ? new Date(item.created_at).toLocaleString() : "";
        const jobTitle = item.job_title || "Job";
        const candidate = item.full_name || item.email || "Candidate";
        return `
          <article class="job-card" style="padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
              <div>
                <p style="margin:0;font-weight:600;">${esc(item.message || "New application")}</p>
                <p class="p-muted" style="margin:4px 0 0;">${esc(jobTitle)} • ${esc(candidate)}</p>
                ${Number(item.is_read) === 1 ? "" : `<button class="btn btn-outline" type="button" data-action="read-application-notification" data-notification-id="${Number(item.id || 0)}" style="margin-top:8px;">Mark read</button>`}
              </div>
              <span class="tag-pill bg-blue-100 text-blue-700">${createdAt ? esc(createdAt) : "New"}</span>
            </div>
          </article>
        `;
      })
      .join("");

    if (applicationNotificationFilters) {
      applicationNotificationFilters.querySelectorAll("button[data-notification-filter]").forEach((button) => {
        const active = button.dataset.notificationFilter === notificationFilter;
        button.classList.toggle("btn-primary", active);
        button.classList.toggle("btn-outline", !active);
      });
    }
  };

  const loadApplicationNotifications = async () => {
    try {
      const res = await safeAuthFetch(`${API}/employer/application-notifications?limit=20`);
      const data = await res.json();
      if (!res.ok) return;
      const unread = Number(data?.unread || 0);
      const items = Array.isArray(data?.items) ? data.items : [];
      renderApplicationNotificationsMeta(unread, items);
    } catch (_err) {
      // Keep employer flow uninterrupted when notifications are unavailable.
    }
  };

  const markApplicationNotificationsRead = async () => {
    try {
      const res = await safeAuthFetch(`${API}/employer/application-notifications/read-all`, {
        method: "PUT"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.message || "Failed to mark alerts as read");
        return;
      }
      if (typeof toast === "function") {
        toast("Application alerts marked as read.");
      }
      await loadApplicationNotifications();
    } catch (_err) {
      showError("Failed to mark alerts as read");
    }
  };

  const markSingleApplicationNotificationRead = async (notificationId) => {
    if (!notificationId) return;
    try {
      const res = await safeAuthFetch(`${API}/employer/application-notifications/${notificationId}/read`, {
        method: "PUT"
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showError(data.message || "Failed to mark alert as read");
        return;
      }
      await loadApplicationNotifications();
    } catch (_err) {
      showError("Failed to mark alert as read");
    }
  };

  jobSelect?.addEventListener("change", async () => {
    renderSelectedJobMeta();
    await renderJobHistory(jobSelect.value);
    await loadApplications();
    activeApplicationId = null;
    if (messageMeta) messageMeta.textContent = "Select an application to view messages.";
    if (messageList) messageList.innerHTML = "";
    renderCandidateProfile(null);
  });

  refreshJobs?.addEventListener("click", async () => {
    await loadJobs();
    await loadStats();
  });

  markNotificationsReadBtn?.addEventListener("click", async () => {
    await markApplicationNotificationsRead();
  });

  applicationNotificationsList?.addEventListener("click", async (event) => {
    const button = event.target.closest('[data-action="read-application-notification"]');
    if (!button) return;
    const notificationId = Number(button.dataset.notificationId || 0);
    await markSingleApplicationNotificationRead(notificationId);
  });

  applicationNotificationFilters?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-notification-filter]");
    if (!button) return;
    notificationFilter = String(button.dataset.notificationFilter || "unread");
    await loadApplicationNotifications();
  });

  bulkCsvFile?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      parsedBulkRows = [];
      if (bulkCsvMeta) bulkCsvMeta.textContent = "No file selected";
      return;
    }

    if (bulkCsvMeta) bulkCsvMeta.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;

    try {
      const csvText = await file.text();
      parsedBulkRows = parseBulkCsv(csvText);
      if (bulkUploadResult) {
        bulkUploadResult.textContent = parsedBulkRows.length
          ? `Loaded ${parsedBulkRows.length} rows. Run Dry Run to validate.`
          : "No data rows found in CSV file.";
      }
      renderBulkIssues([]);
    } catch (err) {
      parsedBulkRows = [];
      if (bulkUploadResult) bulkUploadResult.textContent = "Failed to parse CSV file.";
    }
  });

  downloadBulkTemplateBtn?.addEventListener("click", () => {
    const template = [
      "title,location,job_type,category,description,salary_min,salary_max,experience_level,is_remote,benefits,application_deadline",
      'Frontend Developer,Remote,Full-time,IT,"Build and maintain modern web interfaces using React and TypeScript.",50000,70000,Mid-level,true,"Health insurance;Remote stipend",2026-06-30',
      'Product Designer,London,Contract,Design,"Design wireframes and UI systems across product flows.",45000,65000,Senior,false,"Flexible hours",2026-07-15'
    ].join("\n");

    const blob = new Blob([template], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "jobportal-bulk-template.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const runBulkUpload = async (dryRun) => {
    if (!parsedBulkRows.length) {
      showWarning("Please choose a CSV file first.");
      return;
    }

    try {
      const res = await safeAuthFetch(`${API}/employer/jobs/bulk-upload`, {
        method: "POST",
        body: JSON.stringify({ jobs: parsedBulkRows, dry_run: dryRun })
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (bulkUploadResult) bulkUploadResult.textContent = data.message || "Bulk upload failed.";
        renderBulkIssues(data.invalid_rows || data.create_errors || []);
        return;
      }

      if (dryRun) {
        if (bulkUploadResult) {
          bulkUploadResult.textContent = `Dry run complete: ${data.valid_rows}/${data.total_rows} valid rows.`;
        }
        renderBulkIssues(data.invalid_rows || []);
        return;
      }

      if (bulkUploadResult) {
        bulkUploadResult.textContent = `Created ${data.created_count} jobs out of ${data.total_rows} rows.`;
      }
      renderBulkIssues([...(data.skipped_invalid_rows || []), ...(data.create_errors || [])]);
      await loadJobs();
      await loadStats();
    } catch (err) {
      console.error(err);
      if (bulkUploadResult) bulkUploadResult.textContent = "Bulk upload failed due to server error.";
    }
  };

  bulkDryRunBtn?.addEventListener("click", () => runBulkUpload(true));
  bulkUploadBtn?.addEventListener("click", () => runBulkUpload(false));

  renewJobBtn?.addEventListener("click", async () => {
    const selectedJobId = jobSelect?.value;
    if (!selectedJobId) {
      showWarning("Select a job first");
      return;
    }

    if (!confirm("Renew this job for 30 more days?")) return;

    try {
      const res = await safeAuthFetch(`${API}/employer/jobs/${selectedJobId}/renew`, {
        method: "PUT"
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError(data.message || "Failed to renew job");
        return;
      }

      showSuccess(data.message || "Job renewed");
      await loadJobs();
    } catch (err) {
      console.error(err);
      showError("Failed to renew job");
    }
  });

  reboostJobBtn?.addEventListener("click", async () => {
    const selectedJobId = jobSelect?.value;
    if (!selectedJobId) {
      showWarning("Select a job first");
      return;
    }

    if (!confirm("Re-Boost this job with premium payment?")) return;

    try {
      const checkoutRes = await safeAuthFetch(`${API}/payments/create-checkout-session`, {
        method: "POST",
        body: JSON.stringify({ mode: "reboost", jobId: selectedJobId, payment_method: "card" })
      });
      const checkoutData = await checkoutRes.json().catch(() => ({}));
      if (!checkoutRes.ok || !checkoutData.url) {
        showError(checkoutData.message || "Failed to start payment");
        return;
      }
      window.location.href = checkoutData.url;
    } catch (err) {
      console.error(err);
      showError("Failed to start payment");
    }
  });
  refreshMessages?.addEventListener("click", () => loadMessages(activeApplicationId));

  shiftPaymentConfirmBtn?.addEventListener("click", () => {
    const method = shiftPaymentMethods.includes(selectedShiftPaymentMethod)
      ? selectedShiftPaymentMethod
      : "card";
    resolveShiftPaymentMethod(method);
  });

  shiftPaymentOptions?.addEventListener("click", (event) => {
    const button = event.target.closest(".payment-method-option");
    if (!button) return;

    const method = String(button.getAttribute("data-method") || "").toLowerCase();
    if (!shiftPaymentMethods.includes(method)) return;

    setShiftPaymentSelection(method);
  });

  shiftPaymentOptions?.addEventListener("keydown", (event) => {
    const options = getShiftPaymentButtons();
    if (!options.length) return;

    const currentIndex = options.findIndex((option) => option.classList.contains("is-selected"));
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    let nextIndex = safeIndex;

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      nextIndex = (safeIndex + 1) % options.length;
      setShiftPaymentSelection(options[nextIndex].getAttribute("data-method"), { focus: true });
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      nextIndex = (safeIndex - 1 + options.length) % options.length;
      setShiftPaymentSelection(options[nextIndex].getAttribute("data-method"), { focus: true });
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      setShiftPaymentSelection(options[0].getAttribute("data-method"), { focus: true });
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      setShiftPaymentSelection(options[options.length - 1].getAttribute("data-method"), { focus: true });
      return;
    }

    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      const activeElement = document.activeElement;
      const focusedMethod = activeElement?.getAttribute?.("data-method");
      if (focusedMethod) {
        setShiftPaymentSelection(focusedMethod, { focus: true });
      }
    }
  });

  const cancelShiftPaymentSelection = () => resolveShiftPaymentMethod(null);

  shiftPaymentCancelBtn?.addEventListener("click", cancelShiftPaymentSelection);
  shiftPaymentCloseBtn?.addEventListener("click", cancelShiftPaymentSelection);

  shiftPaymentModal?.addEventListener("click", (event) => {
    if (event.target?.id === "shiftPaymentModal") {
      cancelShiftPaymentSelection();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && shiftPaymentModal && !shiftPaymentModal.classList.contains("hidden")) {
      cancelShiftPaymentSelection();
    }
  });

  document.querySelector(".pipeline-board")?.addEventListener("click", async (event) => {
    const action = event.target.getAttribute("data-action");
    const appId = event.target.getAttribute("data-id");
    const jobId = event.target.getAttribute("data-job-id");
    if (!action) return;

    if (action === "accept-shift") {
      if (!appId) return;
      const paymentMethod = await requestShiftPaymentMethod();
      if (!paymentMethod) return;
      try {
        const paymentMethod = await resolveShiftPaymentMethod();
        if (!paymentMethod) {
          return;
        }

        const res = await safeAuthFetch(`${API}/shifts/applications/${appId}/accept`, {
          method: "POST",
          body: JSON.stringify({ payment_method: paymentMethod })
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.message || "Failed to accept shift");
          return;
        }
        const methodLabel = data.payment_method ? `\nPayment method: ${data.payment_method}` : "";
        showSuccess((data.message || "Shift accepted") + methodLabel);
        await loadApplications();
        return;
      } catch (err) {
        console.error(err);
        showError("Failed to accept shift");
        return;
      }
    }

    if (action === "client-confirm") {
      if (!jobId) return;
      try {
        const res = await safeAuthFetch(`${API}/shifts/${jobId}/client-confirm`, {
          method: "POST"
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.message || "Failed to confirm shift");
          return;
        }
        showSuccess(data.message || "Shift confirmed");
        await loadApplications();
        return;
      } catch (err) {
        console.error(err);
        showError("Failed to confirm shift");
        return;
      }
    }

    if (action === "message") {
      if (!appId) return;
      activeApplicationId = Number(appId);
      const app = applications.find(item => String(item.id) === String(appId));
      const candidate = app?.full_name || app?.user_name || "Candidate";
      if (messageMeta) messageMeta.textContent = `Chat with ${candidate}`;
      renderCandidateProfile(app);
      await loadMessages(activeApplicationId);
      return;
    }

    if (action === "profile") {
      if (!appId) return;
      const app = applications.find(item => String(item.id) === String(appId));
      if (app?.user_id) {
        window.open(`profile.html?userId=${app.user_id}`, "_blank");
      }
      renderCandidateProfile(app);
      return;
    }

    if (action === "schedule-interview") {
      if (!appId) return;
      const app = applications.find(item => String(item.id) === String(appId));
      const candidate = app?.full_name || app?.user_name || "Candidate";

      const whenRaw = prompt(`Schedule interview with ${candidate}.\nEnter date and time (YYYY-MM-DD HH:mm):`);
      if (!whenRaw) return;
      const normalizedWhen = whenRaw.trim().replace(" ", "T");

      const meetingTypeInput = prompt("Meeting type: video, phone, or onsite", "video");
      if (!meetingTypeInput) return;
      const meetingType = meetingTypeInput.trim().toLowerCase();

      const meetingLink = prompt("Meeting link or location (optional)", "") || "";
      const notes = prompt("Interview notes (optional)", "") || "";

      try {
        const res = await safeAuthFetch(`${API}/employer/applications/${appId}/interviews`, {
          method: "POST",
          body: JSON.stringify({
            scheduled_at: normalizedWhen,
            meeting_type: meetingType,
            meeting_link: meetingLink,
            notes,
            duration_minutes: 30
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.message || "Failed to schedule interview");
          return;
        }
        showSuccess(`Interview scheduled for ${candidate}`);
        await loadApplications();
      } catch (err) {
        console.error(err);
        showError("Failed to schedule interview");
      }
      return;
    }

    if (action === "background-check") {
      if (!appId) return;
      const provider = prompt("Background check provider", "internal") || "internal";
      const packageName = prompt("Package name", "standard") || "standard";
      const notes = prompt("Background check notes (optional)", "") || "";

      try {
        const res = await safeAuthFetch(`${API}/employer/applications/${appId}/background-check`, {
          method: "POST",
          body: JSON.stringify({
            provider,
            package_name: packageName,
            notes
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.message || "Failed to order background check");
          return;
        }
        showSuccess(`Background check ordered. Ref: ${data.reference_code || "N/A"}`);
      } catch (err) {
        console.error(err);
        showError("Failed to order background check");
      }
      return;
    }

    if (action === "save-eval") {
      if (!appId) return;
      const scoreInput = document.querySelector(`[data-score-input="${appId}"]`);
      const statusInput = document.querySelector(`[data-interview-status-input="${appId}"]`);
      const notesInput = document.querySelector(`[data-interview-notes-input="${appId}"]`);

      const scoreValue = (scoreInput?.value || "").trim();
      const payload = {
        score: scoreValue === "" ? null : Number(scoreValue),
        interview_status: (statusInput?.value || "not_started").trim(),
        interview_notes: (notesInput?.value || "").trim()
      };

      try {
        const res = await safeAuthFetch(`${API}/employer/applications/${appId}/evaluation`, {
          method: "PUT",
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.message || "Failed to save evaluation");
          return;
        }
        await loadApplications();
      } catch (err) {
        console.error(err);
        showError("Failed to save evaluation");
      }
      return;
    }

    if (action === "move") {
      if (!appId) return;
      const select = document.querySelector(`[data-stage-select="${appId}"]`);
      if (!select) return;

      try {
        const res = await safeAuthFetch(`${API}/employer/applications/${appId}/pipeline`, {
          method: "PUT",
          body: JSON.stringify({ pipeline_stage: select.value })
        });
        const data = await res.json();
        if (!res.ok) {
          showError(data.message || "Failed to update stage");
          return;
        }
        await loadApplications();
      } catch (err) {
        console.error(err);
        showError("Failed to update stage");
      }
    }
  });

  messageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!activeApplicationId) {
      showWarning("Select an application first");
      return;
    }

    const message = (messageInput.value || "").trim();
    if (!message) return;

    try {
      const res = await safeAuthFetch(`${API}/messages/applications/${activeApplicationId}/messages`, {
        method: "POST",
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to send message");
        return;
      }
      messageInput.value = "";
      await loadMessages(activeApplicationId);
    } catch (err) {
      console.error(err);
      showError("Failed to send message");
    }
  });

  await loadJobs();
  await loadStats();
  await loadApplicationNotifications();
  connectEmployerRealtime();
  // Optionally, keep polling notifications as fallback
  setInterval(loadApplicationNotifications, 30000);
});

/* ============================================================
   SHIFT PAYMENT MODAL
   ============================================================ */

const SHIFT_PAYMENT_LABELS = {
  card: "Card",
  applepay: "Apple Pay",
  gpay: "Google Pay",
  paypal: "PayPal",
  bank_transfer: "Bank Transfer",
};

function getShiftPaymentButtons() {
  return Array.from(document.querySelectorAll("#shiftPaymentOptions .payment-method-option"));
}

function getShiftPaymentLabel(method) {
  return SHIFT_PAYMENT_LABELS[method] || method;
}

function setShiftPaymentSelection(method, { focus = false } = {}) {
  const buttons = getShiftPaymentButtons();
  const selectedText = document.getElementById("shiftPaymentSelectedText");
  buttons.forEach((btn) => {
    const isSelected = btn.dataset.method === method;
    btn.classList.toggle("is-selected", isSelected);
    btn.setAttribute("aria-selected", isSelected ? "true" : "false");
    btn.setAttribute("tabindex", isSelected ? "0" : "-1");
    if (isSelected) {
      // Restart pulse animation
      btn.classList.remove("selection-animate");
      void btn.offsetWidth; // force reflow
      btn.classList.add("selection-animate");
      if (focus) btn.focus();
    }
  });
  if (selectedText) {
    selectedText.textContent = "Selected: " + getShiftPaymentLabel(method);
  }
}

let _shiftPaymentResolve = null;

function openShiftPaymentModal() {
  return new Promise((resolve) => {
    _shiftPaymentResolve = resolve;
    const modal = document.getElementById("shiftPaymentModal");
    if (!modal) { resolve("card"); return; }
    modal.classList.remove("hidden");
    setShiftPaymentSelection("card");
    getShiftPaymentButtons()[0]?.focus();
  });
}

function closeShiftPaymentModal(chosenMethod) {
  const modal = document.getElementById("shiftPaymentModal");
  if (modal) modal.classList.add("hidden");
  if (_shiftPaymentResolve) {
    _shiftPaymentResolve(chosenMethod || null);
    _shiftPaymentResolve = null;
  }
}

// Click on a payment option card
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#shiftPaymentOptions .payment-method-option");
  if (btn) {
    setShiftPaymentSelection(btn.dataset.method, { focus: true });
    return;
  }
  if (e.target.closest("#shiftPaymentConfirm")) {
    const selected = document.querySelector("#shiftPaymentOptions .payment-method-option.is-selected");
    closeShiftPaymentModal(selected?.dataset.method || "card");
    return;
  }
  if (e.target.closest("#shiftPaymentCancel")) {
    closeShiftPaymentModal(null);
  }
});

// Keyboard navigation within payment modal
document.addEventListener("keydown", (e) => {
  const modal = document.getElementById("shiftPaymentModal");
  if (!modal || modal.classList.contains("hidden")) return;
  const buttons = getShiftPaymentButtons();
  const currentIdx = buttons.findIndex((b) => b === document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    e.preventDefault();
    const next = (currentIdx + 1) % buttons.length;
    setShiftPaymentSelection(buttons[next].dataset.method, { focus: true });
  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    e.preventDefault();
    const prev = (currentIdx - 1 + buttons.length) % buttons.length;
    setShiftPaymentSelection(buttons[prev].dataset.method, { focus: true });
  } else if (e.key === "Home") {
    e.preventDefault();
    setShiftPaymentSelection(buttons[0].dataset.method, { focus: true });
  } else if (e.key === "End") {
    e.preventDefault();
    setShiftPaymentSelection(buttons[buttons.length - 1].dataset.method, { focus: true });
  } else if (e.key === "Enter" || e.key === " ") {
    if (document.activeElement.closest("#shiftPaymentOptions")) {
      e.preventDefault();
      const selected = document.querySelector("#shiftPaymentOptions .payment-method-option.is-selected");
      closeShiftPaymentModal(selected?.dataset.method || "card");
    }
  } else if (e.key === "Escape") {
    closeShiftPaymentModal(null);
  }
});

// Legacy bridge used by accept-shift code
async function resolveShiftPaymentMethod() {
  return await openShiftPaymentModal();
}
