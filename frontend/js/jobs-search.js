const getCompanyInitials = (name = "Company") => {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "CO";
  const initials = words.slice(0, 2).map(word => word[0]?.toUpperCase() || "").join("");
  return initials || "CO";
};

const sanitizeJobText = (str) => String(str == null ? "" : str)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const getJobTypeLabel = (job) => {
  if (job.is_shift) return "Shift";
  return job.job_type || job.jobType || job.category || "Full-Time";
};

const getSalaryLabel = (job) => {
  if (job.salary_min && job.salary_max) return `$${Number(job.salary_min).toLocaleString()} â€“ $${Number(job.salary_max).toLocaleString()}`;
  if (job.salary_min) return `From $${Number(job.salary_min).toLocaleString()}`;
  if (job.salary_max) return `Up to $${Number(job.salary_max).toLocaleString()}`;
  const salary = job.salary || job.salary_range || job.pay_range;
  if (salary) return String(salary);
  if (job.shift_pay_cents) return `$${Math.round(job.shift_pay_cents / 100)}`;
  return "Competitive";
};

const formatInsightMoney = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return "-";
  return `$${Math.round(Number(value)).toLocaleString()}`;
};

const renderInsightList = (el, rows, labelKey) => {
  if (!el) return;
  if (!Array.isArray(rows) || !rows.length) {
    el.innerHTML = "<li class=\"p-muted\">No data for current filters.</li>";
    return;
  }

  el.innerHTML = rows
    .map((row) => {
      const label = sanitizeJobText(row[labelKey] || "Unspecified");
      const count = Number(row.job_count || 0);
      const salary = formatInsightMoney(row.avg_salary);
      return `<li><span>${label}</span><span>${salary} Â· ${count} jobs</span></li>`;
    })
    .join("");
};

const loadSalaryInsights = async (params) => {
  const meta = document.getElementById("salaryInsightsMeta");
  const avgSalary = document.getElementById("insightAvgSalary");
  const avgMin = document.getElementById("insightAvgMin");
  const avgMax = document.getElementById("insightAvgMax");
  const coverage = document.getElementById("insightCoverage");
  const topCategories = document.getElementById("insightTopCategories");
  const topLocations = document.getElementById("insightTopLocations");
  const byExperience = document.getElementById("insightByExperience");

  if (meta) meta.textContent = "Loading salary intelligence...";

  try {
    const query = params ? params.toString() : "";
    const res = await authFetch(`${API}/jobs/salary-insights${query ? "?" + query : ""}`);
    if (!res.ok) throw new Error("insights request failed");
    const insights = await res.json();

    const summary = insights?.summary || {};
    if (avgSalary) avgSalary.textContent = formatInsightMoney(summary.avg_salary);
    if (avgMin) avgMin.textContent = formatInsightMoney(summary.avg_salary_min);
    if (avgMax) avgMax.textContent = formatInsightMoney(summary.avg_salary_max);
    if (coverage) {
      const total = Number(summary.total_jobs || 0);
      const withSalary = Number(summary.jobs_with_salary || 0);
      const pct = total > 0 ? Math.round((withSalary / total) * 100) : 0;
      coverage.textContent = `${withSalary}/${total} (${pct}%)`;
    }

    renderInsightList(topCategories, insights?.top_categories || [], "category");
    renderInsightList(topLocations, insights?.top_locations || [], "location");
    renderInsightList(byExperience, insights?.by_experience || [], "experience_level");

    if (meta) {
      const total = Number(summary.total_jobs || 0);
      meta.textContent = total
        ? `Based on ${total} active jobs matching your filters.`
        : "No matching active jobs yet.";
    }
  } catch (_err) {
    if (avgSalary) avgSalary.textContent = "-";
    if (avgMin) avgMin.textContent = "-";
    if (avgMax) avgMax.textContent = "-";
    if (coverage) coverage.textContent = "-";
    renderInsightList(topCategories, [], "category");
    renderInsightList(topLocations, [], "location");
    renderInsightList(byExperience, [], "experience_level");
    if (meta) meta.textContent = "Salary insights unavailable right now.";
  }
};

const hasActiveInsightsFilters = (state) => {
  return Boolean(
    state.q ||
    state.category ||
    state.location ||
    state.jobType ||
    state.experience ||
    state.salaryMin ||
    state.salaryMax ||
    state.workType ||
    state.shiftMode
  );
};

const setSalaryInsightsVisibility = (visible) => {
  const section = document.getElementById("salaryInsights");
  const meta = document.getElementById("salaryInsightsMeta");
  if (!section) return;
  section.classList.toggle("hidden", !visible);
  if (!visible && meta) {
    meta.textContent = "Apply one or more filters to view salary insights.";
  }
};

const getTagList = (job) => {
  const tags = [];
  const location = (job.location || "").toLowerCase();
  const title = (job.title || "").toLowerCase();

  if (location.includes("remote")) tags.push("Remote");
  if (location.includes("hybrid")) tags.push("Hybrid");
  tags.push(getJobTypeLabel(job));
  if (title.includes("senior")) tags.push("Senior");
  if (title.includes("react")) tags.push("React");

  return Array.from(new Set(tags)).slice(0, 4);
};

const renderCompanyAvatar = (job) => {
  if (job.company_logo) {
    return `<img class="job-company-avatar" src="${sanitizeJobText(job.company_logo)}" alt="${sanitizeJobText(job.company_name || "Company")}" />`;
  }

  return `<span class="job-company-avatar job-company-avatar-fallback" aria-hidden="true">${getCompanyInitials(job.company_name || "Company")}</span>`;
};

const buildJobDetailHref = (jobId) => `job.html?jobId=${jobId}&id=${jobId}`;

const getSelectedCategoryFilter = () => {
  const select = document.getElementById("categoryFilter");
  const customInput = document.getElementById("categoryFilterCustom");
  const selected = (select?.value || "").trim();
  if (selected.toLowerCase() !== "other") {
    return selected;
  }
  return (customInput?.value || "").trim();
};

const syncCategoryFilterCustomInput = () => {
  const select = document.getElementById("categoryFilter");
  const customInput = document.getElementById("categoryFilterCustom");
  if (!select || !customInput) return;

  const isOther = (select.value || "").toLowerCase() === "other";
  customInput.style.display = isOther ? "block" : "none";
  if (!isOther) {
    customInput.value = "";
  }
};

const upsertCategoryOption = (select, value) => {
  if (!select || !value) return;

  const exists = Array.from(select.options).some((opt) => opt.value.toLowerCase() === value.toLowerCase());
  if (exists) return;

  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;

  const otherOption = Array.from(select.options).find((opt) => opt.value.toLowerCase() === "other");
  if (otherOption) {
    select.insertBefore(option, otherOption);
  } else {
    select.appendChild(option);
  }
};

const syncCategoryFilterOptionsFromJobs = (jobs) => {
  const select = document.getElementById("categoryFilter");
  if (!select || !Array.isArray(jobs)) return;

  jobs.forEach((job) => {
    const category = String(job?.category || "").trim();
    if (category) {
      upsertCategoryOption(select, category);
    }
  });
};

const renderJobCard = (job, options = {}) => {
  const { includeSaveButton = true, saved = false } = options;
  const matchScore = getMatchScore(job);
  const showSaveButton = includeSaveButton && Number(job.is_approved) === 1;
  const premiumBadge = job.is_premium
    ? '<span class="badge badge-premium">Premium</span>'
    : "";
  const shiftBadge = job.is_shift
    ? '<span class="badge badge-shift">Shift</span>'
    : "";
  const verifiedBadge = job.company_name
    ? '<span class="badge badge-verified">Verified</span>'
    : "";
  const pendingBadge = Number(job.is_approved) !== 1
    ? '<span class="badge badge-pending">Pending approval</span>'
    : "";
  const premiumClass = job.is_premium ? "premium-job" : "";
  const companyName = job.company_name || "Stealth Company";
  const companyLink = job.company_id
    ? `<a class="company-link" href="company.html?companyId=${Number(job.company_id)}">${sanitizeJobText(companyName)}</a>`
    : `<span class="company-link">${sanitizeJobText(companyName)}</span>`;
  const tagsMarkup = getTagList(job).map(tag => `<span class="job-tag">${sanitizeJobText(tag)}</span>`).join("");
  const description = sanitizeJobText(job.description || job.summary || "Explore role details and requirements from this verified employer.");
  const imageHtml = job.image_url
    ? `<img class="job-card-image" src="${apiOrigin}${sanitizeJobText(job.image_url)}" alt="${sanitizeJobText(job.title)}" loading="lazy">`
    : "";
  const hasImageClass = job.image_url ? "has-image" : "";

  return `
    <div class="job-card ${premiumClass} ${hasImageClass}">
      ${imageHtml}
      <div class="job-card-top">
        <div class="job-card-head">
          ${renderCompanyAvatar(job)}
          <div class="job-card-content">
            <h3 class="job-card-title">${sanitizeJobText(job.title)}</h3>
            <p class="job-company-line">
              <i class="fa-solid fa-building"></i>
              ${companyLink}
            </p>
          </div>
        </div>
        <div class="job-card-badges">
          ${premiumBadge}
          ${shiftBadge}
          ${verifiedBadge}
          ${pendingBadge}
          <span class="match-pill">${matchScore}% Match</span>
        </div>
      </div>

      <div class="job-info-list">
        <span><i class="fa-solid fa-location-dot"></i> ${sanitizeJobText(job.location || "Location not specified")}</span>
        <span><i class="fa-solid fa-briefcase"></i> ${sanitizeJobText(getJobTypeLabel(job))}</span>
        <span><i class="fa-solid fa-sack-dollar"></i> ${sanitizeJobText(getSalaryLabel(job))}</span>
      </div>

      <div class="job-tag-row">${tagsMarkup}</div>

      <p class="job-desc job-card-description">${description}</p>

      <div class="job-card-actions">
        <a href="${buildJobDetailHref(job.id)}" class="btn btn-ghost job-action-btn" data-job-id="${job.id}">Details</a>
        <a href="apply.html?jobId=${job.id}" class="apply-btn job-action-btn" data-job-id="${job.id}"><i class="fa-solid fa-rocket"></i> Apply Now</a>
        ${showSaveButton ? `<button class="btn btn-outline save-btn" type="button" data-save-id="${job.id}" data-saved="${saved ? 1 : 0}">${saved ? "Saved" : "Save"}</button>` : ""}
      </div>
    </div>
  `;
};

const fetchJobsWithFallback = async () => {
  const candidates = Array.from(new Set([
    `${API}/jobs`,
    `${window.location.origin}/api/jobs`,
    "http://localhost:3000/api/jobs"
  ]));

  let lastError = null;

  for (const url of candidates) {
    try {
      const res = await authFetch(url);
      const data = await res.json().catch(() => []);

      if (!res.ok) {
        throw new Error((data && data.message) ? data.message : `Failed to fetch jobs (${res.status})`);
      }

      return Array.isArray(data) ? data : [];
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Unable to load jobs from any API origin");
};

async function loadJobs() {
  const q = document.getElementById("searchInput").value;
  const categorySelect = document.getElementById("categoryFilter");
  const categoryCustomInput = document.getElementById("categoryFilterCustom");
  const selectedCategory = (categorySelect?.value || "").trim();
  const categoryCustom = (categoryCustomInput?.value || "").trim();
  const category = selectedCategory.toLowerCase() === "other" ? categoryCustom : selectedCategory;
  const location = document.getElementById("locationFilter")?.value || "";
  const jobType = document.getElementById("typeFilter")?.value || "";
  const experience = document.getElementById("experienceFilter")?.value || "";
  const salaryMin = document.getElementById("salaryMinFilter")?.value || "";
  const salaryMax = document.getElementById("salaryMaxFilter")?.value || "";
  const shiftMode = document.getElementById("shiftFilter")?.value || "";
  const activeWorkTypeBtn = document.querySelector("#workTypeFilters .work-type-btn.active");
  const workType = activeWorkTypeBtn ? activeWorkTypeBtn.dataset.workType || "" : "";
  const skeleton = document.getElementById("jobsSkeleton");
  const resultsCount = document.getElementById("jobsResultCount");
  const resultsHint = document.getElementById("jobsResultHint");

  try {
    if (skeleton) {
      skeleton.innerHTML = Array.from({ length: 6 })
        .map(() => "<div class=\"skeleton-card\"></div>")
        .join("");
      skeleton.classList.remove("hidden");
    }

    const params = new URLSearchParams();
    if (q) params.set("keyword", q);
    if (category) params.set("category", category);
    if (location) params.set("location", location);
    if (jobType) params.set("job_type", jobType);
    if (experience) params.set("experience_level", experience);
    if (salaryMin) params.set("salary_min", salaryMin);
    if (salaryMax) params.set("salary_max", salaryMax);
    if (workType === "Remote") params.set("is_remote", "1");
    if (shiftMode === "shift") params.set("is_shift", "1");
    if (shiftMode === "non_shift") params.set("is_shift", "0");

    const activeFilterState = { q, category, location, jobType, experience, salaryMin, salaryMax, workType, shiftMode };
    const hasActiveFilter = hasActiveInsightsFilters(activeFilterState);
    setSalaryInsightsVisibility(hasActiveFilter);

    const paramStr = params.toString();
    if (hasActiveFilter) {
      loadSalaryInsights(params);
    }
    const res = await authFetch(`${API}/jobs${paramStr ? "?" + paramStr : ""}`);
    const jobs = await res.json();
    syncCategoryFilterOptionsFromJobs(jobs || []);
    const container = document.getElementById("jobs");
    container.innerHTML = "";
    if (skeleton) skeleton.classList.add("hidden");

    // Secondary client-side filter (title/work-type keyword matching not sent to server)
    const filtered = (jobs || []).filter(job => {
      const locationValue = (job.location || "").toLowerCase();
      const workTypeMatch = !workType ||
        locationValue.includes(workType.toLowerCase()) ||
        (job.work_type || "").toLowerCase().includes(workType.toLowerCase()) ||
        (workType === "Remote" && job.is_remote);
      return workTypeMatch;
    });

    // Demo-safe fallback: if filters are too restrictive, show all jobs instead of an empty page.
    if (!filtered.length && hasActiveFilters) {
      filtered = jobs;
      if (resultsHint) {
        resultsHint.textContent = "No exact matches for your filters. Showing all available roles instead.";
      }
    }

    if (!filtered.length) {
      if (hasActiveFilter && Array.isArray(jobs) && jobs.length) {
        if (resultsCount) resultsCount.textContent = String(jobs.length);
        if (resultsHint) resultsHint.textContent = "No exact matches for current filters. Showing all roles instead.";
        jobs.forEach(job => {
          container.innerHTML += renderJobCard(job, { includeSaveButton: true, saved: !!job.is_saved });
        });
        saveSearchState({ q, category, categoryCustom, location, jobType, experience, salaryMin, salaryMax, workType, shiftMode });
        renderRecentSearches();
        return;
      }

      if (resultsCount) resultsCount.textContent = "0";
      if (resultsHint) resultsHint.textContent = "No roles match your current filters. Try broadening your search.";
      container.innerHTML = "<p class=\"empty-state\">No jobs found. Try adjusting your filters.</p>";
      return;
    }

    if (resultsCount) resultsCount.textContent = String(filtered.length);
    if (resultsHint) {
      const filterLabels = [
        q ? `keyword: ${q}` : "",
        category ? `category: ${category}` : "",
        location ? `location: ${location}` : "",
        workType ? `work type: ${workType}` : ""
      ].filter(Boolean);

      resultsHint.textContent = filterLabels.length
        ? `Showing matches for ${filterLabels.join(" | ")}.`
        : "Showing all available roles from verified employers."
    }

    filtered.forEach(job => {
      container.innerHTML += renderJobCard(job, { includeSaveButton: true, saved: !!job.is_saved });
    });

    saveSearchState({ q, category, categoryCustom, location, jobType, experience, salaryMin, salaryMax, workType, shiftMode });
    renderRecentSearches();
  } catch (err) {
    console.error("Error loading jobs:", err);
    document.getElementById("jobs").innerHTML = "<p>Error loading jobs</p>";
    const resultsCount = document.getElementById("jobsResultCount");
    const resultsHint = document.getElementById("jobsResultHint");
    if (resultsCount) resultsCount.textContent = "0";
    if (resultsHint) resultsHint.textContent = "Unable to load roles right now. Please try again.";
    if (skeleton) skeleton.classList.add("hidden");
  }
}

const parseJobSearchState = () => {
  const raw = localStorage.getItem("jobSearchState");
  if (!raw) return {};
  try {
    return JSON.parse(raw) || {};
  } catch (err) {
    console.error("Invalid JSON in localStorage.jobSearchState", err);
    localStorage.removeItem("jobSearchState");
    return {};
  }
};

const getMatchScore = (job) => {
  const state = parseJobSearchState();

  let score = 62;
  const title = (job.title || "").toLowerCase();
  const location = (job.location || "").toLowerCase();
  const category = (job.category || "").toLowerCase();

  if (state.q && title.includes(state.q.toLowerCase())) score += 15;
  if (state.category && category === state.category.toLowerCase()) score += 10;
  if (state.location && location.includes(state.location.toLowerCase())) score += 8;
  if (state.workType && location.includes(String(state.workType).toLowerCase())) score += 8;
  if (job.is_premium) score += 3;
  if (job.is_shift) score += 4;

  return Math.min(98, Math.max(55, score));
};

const matchSalaryRange = (job, salaryMin, salaryMax) => {
  if (!salaryMin && !salaryMax) return true;
  const jobMin = job.salary_min != null ? Number(job.salary_min) : null;
  const jobMax = job.salary_max != null ? Number(job.salary_max) : (job.shift_pay_cents ? Math.round(job.shift_pay_cents / 100) : null);
  const userMin = salaryMin ? Number(salaryMin) : null;
  const userMax = salaryMax ? Number(salaryMax) : null;
  if (!jobMin && !jobMax) return !userMin; // no salary data â€” only exclude when user wants a minimum
  if (userMin && jobMax !== null && jobMax < userMin) return false;
  if (userMax && jobMin !== null && jobMin > userMax) return false;
  return true;
};

const extractSalaryValue = (job) => {
  if (job.salary) {
    const value = Number(String(job.salary).replace(/[^0-9]/g, ""));
    return Number.isFinite(value) ? value : null;
  }

  if (job.shift_pay_cents) {
    return Math.round(job.shift_pay_cents / 100);
  }

  const description = (job.description || "").toLowerCase();
  const match = description.match(/\$\s?(\d{2,3})k/);
  if (match) {
    return Number(match[1]) * 1000;
  }

  return null;
};

const saveSearchState = (state) => {
  try {
    localStorage.setItem("jobSearchState", JSON.stringify(state));
  } catch (err) {
    console.error(err);
  }
};

// â”€â”€â”€ Saved Searches â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const loadSavedSearches = async () => {
  const token = localStorage.getItem("token");
  const panel = document.getElementById("savedSearchesPanel");
  const select = document.getElementById("savedSearchSelect");
  if (!panel || !select || !token) return;
  try {
    const res = await authFetch(`${API}/jobs/searches`);
    if (!res.ok) return;
    const searches = await res.json();
    while (select.options.length > 1) select.remove(1);
    searches.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.name;
      opt.dataset.filters = JSON.stringify(s.filters);
      select.appendChild(opt);
    });
    panel.style.display = "";
  } catch (_err) {}
};

const applySavedSearch = (filtersJson) => {
  try {
    const f = typeof filtersJson === "string" ? JSON.parse(filtersJson) : filtersJson;
    if (f.q !== undefined) document.getElementById("searchInput").value = f.q || "";
    if (f.location !== undefined) { const el = document.getElementById("locationFilter"); if (el) el.value = f.location || ""; }
    if (f.jobType !== undefined) { const el = document.getElementById("typeFilter"); if (el) el.value = f.jobType || ""; }
    if (f.shiftMode !== undefined) { const el = document.getElementById("shiftFilter"); if (el) el.value = f.shiftMode || ""; }
    if (f.experience !== undefined) { const el = document.getElementById("experienceFilter"); if (el) el.value = f.experience || ""; }
    if (f.salaryMin !== undefined) { const el = document.getElementById("salaryMinFilter"); if (el) el.value = f.salaryMin || ""; }
    if (f.salaryMax !== undefined) { const el = document.getElementById("salaryMaxFilter"); if (el) el.value = f.salaryMax || ""; }
    document.getElementById("advancedFilters")?.classList.remove("hidden");
    document.getElementById("toggleFilters") && (document.getElementById("toggleFilters").textContent = "Hide filters");
    loadJobs();
  } catch (_err) {}
};

const saveCurrentSearch = async () => {
  const q = document.getElementById("searchInput")?.value || "";
  const location = document.getElementById("locationFilter")?.value || "";
  const jobType = document.getElementById("typeFilter")?.value || "";
  const shiftMode = document.getElementById("shiftFilter")?.value || "";
  const experience = document.getElementById("experienceFilter")?.value || "";
  const salaryMin = document.getElementById("salaryMinFilter")?.value || "";
  const salaryMax = document.getElementById("salaryMaxFilter")?.value || "";
  const name = prompt("Name this search (e.g. 'Frontend roles in London'):");
  if (!name || !name.trim()) return;
  try {
    const res = await authFetch(`${API}/jobs/searches`, {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), filters: { q, location, jobType, shiftMode, experience, salaryMin, salaryMax } })
    });
    if (res.ok) {
      showSuccess("Search saved!");
      loadSavedSearches();
    }
  } catch (_err) {}
};

const renderRecentSearches = () => {
  const container = document.getElementById("recentSearches");
  if (!container) return;

  const state = getSearchState();
  const chips = [];

  if (state.q) chips.push(state.q);
  if (state.category) chips.push(state.category);
  if (state.location) chips.push(state.location);
  if (state.workType) chips.push(`Work type: ${state.workType}`);
  if (state.shiftMode === "shift") chips.push("Shift only");
  if (state.shiftMode === "non_shift") chips.push("Non-shift only");

  if (!chips.length) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = chips
    .map((chip) => `<span class="search-chip">${chip}</span>`)
    .join("");
};

const getSearchState = () => {
  return parseJobSearchState();
};

document.getElementById("jobs")?.addEventListener("click", async (event) => {
  const detailsLink = event.target.closest("a[data-job-id]");
  if (detailsLink) {
    sessionStorage.setItem("lastJobId", detailsLink.getAttribute("data-job-id"));
  }

  const button = event.target.closest(".save-btn");
  if (!button) return;

  const jobId = button.getAttribute("data-save-id");
  const saved = button.getAttribute("data-saved") === "1";
  const token = localStorage.getItem("token");

  if (!token) {
    showWarning("Login required");
    return;
  }

  try {
    const res = await authFetch(`${API}/saved-jobs/${jobId}`, {
      method: saved ? "DELETE" : "POST"
    });
    const data = await res.json();
    if (!res.ok) {
      showError(data.message || "Failed to update saved job");
      return;
    }
    await loadJobs();
  } catch (err) {
    console.error(err);
    showError("Failed to update saved job");
  }
});

const toggleButton = document.getElementById("toggleFilters");
const clearButton = document.getElementById("clearFilters");
const advancedFilters = document.getElementById("advancedFilters");

// Work-type toggle buttons
document.getElementById("workTypeGroup")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".work-type-btn");
  if (!btn) return;
  document.querySelectorAll(".work-type-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("workType").value = btn.getAttribute("data-value");
  loadJobs();
});

// Set initial active state
document.querySelector('.work-type-btn[data-value=""]')?.classList.add("active");

toggleButton?.addEventListener("click", () => {
  advancedFilters?.classList.toggle("hidden");
  toggleButton.textContent = advancedFilters?.classList.contains("hidden")
    ? "More filters"
    : "Hide filters";
});

clearButton?.addEventListener("click", () => {
  document.getElementById("searchInput").value = "";
  document.getElementById("categoryFilter").value = "";
  const customCategory = document.getElementById("categoryFilterCustom");
  if (customCategory) customCategory.value = "";
  syncCategoryFilterCustomInput();
  document.getElementById("locationFilter").value = "";
  document.getElementById("typeFilter").value = "";
  document.getElementById("shiftFilter").value = "";
  document.getElementById("experienceFilter").value = "";
  const salaryMinEl = document.getElementById("salaryMinFilter");
  const salaryMaxEl = document.getElementById("salaryMaxFilter");
  if (salaryMinEl) salaryMinEl.value = "";
  if (salaryMaxEl) salaryMaxEl.value = "";
  document.querySelectorAll("#workTypeFilters .work-type-btn").forEach((button) => button.classList.remove("active"));
  const anyWorkTypeButton = document.querySelector('#workTypeFilters .work-type-btn[data-work-type=""]');
  anyWorkTypeButton?.classList.add("active");
  loadJobs();
});

const seedSearchState = () => {
  if (!localStorage.getItem("token")) {
    localStorage.removeItem("jobSearchState");
  }

  const state = getSearchState();
  const query = new URLSearchParams(window.location.search).get("q");
  const isLoggedIn = !!localStorage.getItem("token");

  // For public visitors, avoid stale local filters causing an empty jobs page.
  if (!isLoggedIn) {
    state = {};
    localStorage.removeItem("jobSearchState");
  }

  if (query && !state.q) {
    state.q = query;
    saveSearchState(state);
  }

  document.getElementById("searchInput").value = state.q || "";
  const categorySelect = document.getElementById("categoryFilter");
  const categoryCustom = document.getElementById("categoryFilterCustom");
  const hasKnownCategory = Array.from(categorySelect?.options || []).some(
    (opt) => (opt.value || "").toLowerCase() === String(state.category || "").toLowerCase()
  );
  if (categorySelect) {
    if (state.category && !hasKnownCategory) {
      categorySelect.value = "Other";
    } else {
      categorySelect.value = state.category || "";
    }
  }
  syncCategoryFilterCustomInput();
  if (categoryCustom) {
    const isOther = (categorySelect?.value || "").toLowerCase() === "other";
    if (isOther) {
      categoryCustom.value = state.categoryCustom || state.category || "";
    } else {
      categoryCustom.value = "";
    }
  }
  document.getElementById("locationFilter").value = state.location || "";
  document.getElementById("typeFilter").value = state.jobType || "";
  document.getElementById("shiftFilter").value = state.shiftMode || "";
  document.getElementById("experienceFilter").value = state.experience || "";
  const salaryMinEl = document.getElementById("salaryMinFilter");
  const salaryMaxEl = document.getElementById("salaryMaxFilter");
  if (salaryMinEl) salaryMinEl.value = state.salaryMin || "";
  if (salaryMaxEl) salaryMaxEl.value = state.salaryMax || "";
  document.querySelectorAll("#workTypeFilters .work-type-btn").forEach((button) => {
    const buttonWorkType = button.dataset.workType || "";
    button.classList.toggle("active", buttonWorkType === (state.workType || ""));
  });
  renderRecentSearches();
};

seedSearchState();
const categorySelect = document.getElementById("categoryFilter");
const categoryCustomInput = document.getElementById("categoryFilterCustom");
const shiftFilter = document.getElementById("shiftFilter");
categorySelect?.addEventListener("change", () => {
  syncCategoryFilterCustomInput();
  loadJobs();
});
shiftFilter?.addEventListener("change", loadJobs);
categoryCustomInput?.addEventListener("input", loadJobs);
syncCategoryFilterCustomInput();
loadJobs();
loadSavedSearches();

document.getElementById("savedSearchSelect")?.addEventListener("change", (e) => {
  const opt = e.target.selectedOptions[0];
  if (opt && opt.dataset.filters) applySavedSearch(opt.dataset.filters);
  e.target.value = ""; // reset so same option can be re-applied
});

document.getElementById("saveSearchBtn")?.addEventListener("click", saveCurrentSearch);


// Work type filter button handler
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#workTypeFilters .work-type-btn");
  if (!btn) return;
  document.querySelectorAll("#workTypeFilters .work-type-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  loadJobs();
});
