document.addEventListener("DOMContentLoaded", async () => {
  const params = new URLSearchParams(window.location.search);
  const resolveJobId = () => {
    const candidates = [params.get("jobId"), params.get("id"), sessionStorage.getItem("lastJobId")];

    for (const candidate of candidates) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    return null;
  };

  const jobId = resolveJobId();

  const titleEl = document.getElementById("jobDetailTitle");
  const metaEl = document.getElementById("jobDetailMeta");
  const companyEl = document.getElementById("jobDetailCompany");
  const companyAvatarEl = document.getElementById("jobDetailCompanyAvatar");
  const badgeEl = document.getElementById("jobDetailBadges");
  const infoListEl = document.getElementById("jobDetailInfoList");
  const tagsEl = document.getElementById("jobDetailTags");
  const descEl = document.getElementById("jobDetailDescription");
  const applyBtn = document.getElementById("jobDetailApply");
  const saveBtn = document.getElementById("jobDetailSave");
  const saveTopBtn = document.getElementById("jobDetailBookmark");
  const shareBtn = document.getElementById("jobDetailShare");
  const similarEl = document.getElementById("jobDetailSimilar");
  const highlightsEl = document.getElementById("jobDetailHighlights");
  const companyReviewsSection = document.getElementById("companyReviewsSection");
  const companyReviewsList = document.getElementById("companyReviewsList");
  const companyReviewsEl = companyReviewsList;
  const companyReviewForm = document.getElementById("companyReviewForm");
  const companyReviewName = document.getElementById("crName");
  const companyReviewRating = document.getElementById("crRating");
  const companyReviewMessage = document.getElementById("crMessage");
  const reportJobToggle = document.getElementById("reportJobToggle");
  const reportJobPanel = document.getElementById("reportJobPanel");
  const reportJobForm = document.getElementById("reportJobForm");
  const reportReason = document.getElementById("reportReason");
  const reportDetails = document.getElementById("reportDetails");
  const token = localStorage.getItem("token");
  const rawUser = localStorage.getItem("user");
  let currentUser = null;

  if (rawUser) {
    try {
      currentUser = JSON.parse(rawUser);
    } catch (err) {
      console.error("Invalid JSON in localStorage.user", err);
    }
  }

  const setMissingState = (message = "Job not found") => {
    if (titleEl) titleEl.textContent = message;
  };

  const buildJobDetailHref = (id) => `job.html?jobId=${id}&id=${id}`;

  const fetchJob = async (id) => {
    const directRes = await authFetch(`${API}/jobs/${id}`);
    if (directRes.ok) {
      return directRes.json();
    }

    const listRes = await authFetch(`${API}/jobs`);
    if (!listRes.ok) {
      return null;
    }

    const jobs = await listRes.json();
    return (Array.isArray(jobs) ? jobs : []).find((item) => Number(item.id) === Number(id)) || null;
  };

  if (!jobId) {
    setMissingState();
    return;
  }

  const setText = (el, text) => {
    if (el) el.textContent = text || "";
  };

  const escapeHtml = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const fetchJobById = async (id) => {
    const primary = await authFetch(`${API}/jobs/${id}`);
    const primaryData = await primary.json().catch(() => null);
    if (primary.ok && primaryData && !primaryData.message) {
      return primaryData;
    }

    const fallback = await fetch(`${API}/jobs/${id}`);
    const fallbackData = await fallback.json().catch(() => null);
    if (fallback.ok && fallbackData && !fallbackData.message) {
      return fallbackData;
    }

    // Last-resort fallback for inconsistent detail routing: resolve from list endpoint.
    const listRes = await fetch(`${API}/jobs`);
    const listData = await listRes.json().catch(() => []);
    if (listRes.ok && Array.isArray(listData)) {
      return listData.find((item) => Number(item.id) === Number(id)) || null;
    }

    return null;
  };

  const renderCompanyReviews = (reviews = []) => {
    if (!companyReviewsEl) return;

    if (!reviews.length) {
      companyReviewsEl.innerHTML = '<p class="p-muted">No public reviews yet.</p>';
      return;
    }

    companyReviewsEl.innerHTML = reviews.map((review) => {
      const stars = "â˜…â˜…â˜…â˜…â˜…".slice(0, review.rating) + "â˜†â˜†â˜†â˜†â˜†".slice(0, 5 - review.rating);
      return `
        <article class="review-card">
          <div class="review-header">
            <div>
              <h3>${escapeHtml(review.name)}</h3>
              <p class="meta">${escapeHtml(review.role)}</p>
            </div>
            <span class="review-stars">${stars}</span>
          </div>
          <p class="review-message">${escapeHtml(review.message)}</p>
        </article>
      `;
    }).join("");
  };

  const loadCompanyReviews = async (companyId) => {
    if (!companyId || !companyReviewsEl) return;
    try {
      const res = await fetch(`${API}/reviews/company/${companyId}?limit=6`);
      const data = await res.json().catch(() => []);
      renderCompanyReviews(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      renderCompanyReviews([]);
    }
  };

  const bindCompanyReviewForm = (job) => {
    if (!companyReviewForm || !job?.company_id) return;

    companyReviewForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const name = (document.getElementById("jobReviewName")?.value || "").trim();
      const role = (document.getElementById("jobReviewRole")?.value || "").trim();
      const rating = Number(document.getElementById("jobReviewRating")?.value || 0);
      const message = (document.getElementById("jobReviewMessage")?.value || "").trim();

      if (!name || !role || !rating || !message) {
        showError("Please complete all review fields.");
        return;
      }

      try {
        const res = await fetch(`${API}/reviews/company/${job.company_id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            role,
            rating,
            message,
            employer_user_id: job.posted_by || null,
            job_id: job.id || null
          })
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.message || "Failed to submit review.");
          return;
        }

        companyReviewForm.reset();
        showError("Thanks! Your review is pending approval.");
      } catch (err) {
        console.error(err);
        showError("Network error while submitting review.");
      }
    });
  };

  try {
    const job = await fetchJob(jobId);
    if (!job) {
      setMissingState();
      if (titleEl) titleEl.textContent = "Job not found";
      return;
    }

    sessionStorage.setItem("lastJobId", String(job.id));

    setText(titleEl, job.title || "Role");
    if (applyBtn) applyBtn.href = `apply.html?jobId=${job.id}`;

    const metaItems = [job.location, job.job_type || job.jobType]
      .filter(Boolean)
      .map(item => `<span class="meta-item">${item}</span>`)
      .join("");
    if (metaEl) metaEl.innerHTML = metaItems;

    if (companyAvatarEl) {
      if (job.company_logo) {
        companyAvatarEl.outerHTML = `<img id="jobDetailCompanyAvatar" class="job-company-avatar" src="${job.company_logo}" alt="${job.company_name || "Company"}" />`;
      } else {
        companyAvatarEl.textContent = getCompanyInitials(job.company_name || "Company");
      }
    }

    if (companyEl && job.company_name && job.company_id) {
      companyEl.innerHTML = `
        ${job.company_logo ? `<img class="company-logo-img" src="${job.company_logo}" alt="${job.company_name}" />` : ""}
        <a class="company-link" href="company.html?companyId=${job.company_id}">${job.company_name}</a>
      `;
    } else if (companyEl) {
      companyEl.innerHTML = `<span class="company-link">${job.company_name || "Stealth Company"}</span>`;
    }

    if (badgeEl) {
      const matchScore = getMatchScore(job);
      badgeEl.innerHTML = `
        ${job.is_premium ? '<span class="badge badge-premium">Premium</span>' : ""}
        ${job.is_shift ? '<span class="badge badge-shift">Shift</span>' : ""}
        ${job.company_name ? '<span class="badge badge-verified">Verified</span>' : ""}
        ${Number(job.is_approved) !== 1 ? '<span class="badge badge-pending">Pending approval</span>' : ""}
        <span class="match-pill">${matchScore}% Match</span>
      `;
    }

    if (infoListEl) {
      infoListEl.innerHTML = `
        <span><i class="fa-solid fa-location-dot"></i> ${job.location || "Location not specified"}</span>
        <span><i class="fa-solid fa-briefcase"></i> ${getJobTypeLabel(job)}</span>
        <span><i class="fa-solid fa-sack-dollar"></i> ${getSalaryLabel(job)}</span>
      `;
    }

    if (tagsEl) {
      const tags = getTagList(job);
      tagsEl.innerHTML = tags.map(tag => `<span class="job-tag">${tag}</span>`).join("");
    }

    setText(descEl, job.description || "");

    // Disable apply button for unapproved jobs
    if (applyBtn && Number(job.is_approved) !== 1) {
      applyBtn.textContent = "Pending approval";
      applyBtn.classList.add("btn-disabled");
      applyBtn.style.pointerEvents = "none";
      applyBtn.href = "#";
    }

    // Check if user has already applied for this job
    if (applyBtn && Number(job.is_approved) === 1) {
      const token = localStorage.getItem("token");
      if (token) {
        try {
          const checkRes = await authFetch(`${API}/jobs/${jobId}/check-application`);
          const checkData = await checkRes.json();
          if (checkRes.ok && checkData.hasApplied) {
            applyBtn.textContent = "Already Applied";
            applyBtn.classList.add("btn-disabled");
            applyBtn.style.pointerEvents = "none";
            applyBtn.href = "#";
          }
        } catch (err) {
          console.error("Failed to check application status:", err);
        }
      }
    }

    if (highlightsEl) {
      const highlights = [
        job.category ? `Category: ${job.category}` : null,
        job.shift_pay_cents ? `Shift pay: $${(job.shift_pay_cents / 100).toFixed(2)}` : null,
        job.is_premium ? "Premium placement" : null,
        job.company_name ? "Verified company" : null
      ].filter(Boolean);

      highlightsEl.innerHTML = highlights.length
        ? highlights.map(item => `<li>${item}</li>`).join("")
        : "<li>Fast response hiring process</li>";
    }

    if (similarEl) {
      try {
        const allRes = await fetch(`${API}/jobs`);
        const jobs = allRes.ok ? await allRes.json() : [];
        const similar = (Array.isArray(jobs) ? jobs : [])
          .filter(item => item.id !== job.id)
          .filter(item => item.category === job.category || item.location === job.location)
          .slice(0, 4);

      if (!similar.length) {
        similarEl.innerHTML = "<p class=\"p-muted\">No similar jobs yet.</p>";
      } else {
        similarEl.innerHTML = similar
          .map(item => `
            <a class="mini-card" href="${buildJobDetailHref(item.id)}">
              <div>
                <strong>${item.title}</strong>
                <p class="p-muted"><i class="fa-solid fa-location-dot"></i> ${item.location || "Location not specified"}</p>
              </div>
              <span class="mini-arrow">â†’</span>
            </a>
          `)
          .join("");
      }
      } catch {
        similarEl.innerHTML = "<p class=\"p-muted\">No similar jobs yet.</p>";
      }
    }

    await loadCompanyReviews(Number(job.company_id));
    bindCompanyReviewForm(job);

    if (saveBtn || saveTopBtn) {
      const token = localStorage.getItem("token");
      const canSave = Number(job.is_approved) === 1;
      const syncSaveButtons = (saved) => {
        if (saveBtn) saveBtn.textContent = saved ? "Saved" : "Save job";
        if (saveTopBtn) {
          saveTopBtn.innerHTML = saved
            ? '<i class="fa-solid fa-bookmark"></i> Saved'
            : '<i class="fa-regular fa-bookmark"></i> Save';
        }
      };

      if (!canSave) {
        saveBtn?.classList.add("hidden");
        saveTopBtn?.classList.add("hidden");
      }

      syncSaveButtons(!!job.is_saved);

      const handleSave = async () => {
        if (!token) {
          showWarning("Login required");
          return;
        }
        if (!canSave) {
          showWarning("This job is not available to save yet.");
          return;
        }
        const saved = saveBtn ? saveBtn.textContent === "Saved" : /Saved/i.test(saveTopBtn?.textContent || "");
        const method = saved ? "DELETE" : "POST";
        try {
          const resp = await authFetch(`${API}/saved-jobs/${job.id}`, { method });
          const data = await resp.json();
          if (!resp.ok) {
            showError(data.message || "Failed to update saved job");
            return;
          }
          syncSaveButtons(!saved);
        } catch (err) {
          console.error(err);
          showError("Failed to update saved job");
        }
      };

      saveBtn?.addEventListener("click", handleSave);
      saveTopBtn?.addEventListener("click", handleSave);
    }

    if (shareBtn) {
      shareBtn.addEventListener("click", async () => {
        const pageUrl = window.location.href;
        const title = job.title || "Job Detail";
        try {
          if (navigator.share) {
            await navigator.share({ title, url: pageUrl });
            return;
          }
          await navigator.clipboard.writeText(pageUrl);
          showSuccess("Job link copied to clipboard");
        } catch (err) {
          console.error(err);
          prompt("Copy this link:", pageUrl);
        }
      });
    }

    if (reportJobToggle && reportJobPanel) {
      reportJobToggle.addEventListener("click", () => {
        reportJobPanel.style.display = reportJobPanel.style.display === "none" || !reportJobPanel.style.display ? "block" : "none";
      });
    }

    if (reportJobForm) {
      reportJobForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!token) {
          showWarning("Login required to report a listing");
          return;
        }

        try {
          const resp = await authFetch(`${API}/jobs/${job.id}/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reason: reportReason?.value || "",
              details: reportDetails?.value?.trim() || ""
            })
          });
          const data = await resp.json();
          if (!resp.ok) {
            showError(data.message || "Failed to submit report");
            return;
          }
          showSuccess(data.message || "Report submitted");
          reportJobForm.reset();
          reportJobPanel.style.display = "none";
        } catch (err) {
          console.error(err);
          showError("Failed to submit report");
        }
      });
    }

    if (job.company_id && companyReviewsSection) {
      companyReviewsSection.style.display = "block";
      loadCompanyReviews(job.company_id, companyReviewsList);

      if (companyReviewName && currentUser?.name) {
        companyReviewName.value = currentUser.name;
      }

      if (companyReviewForm) {
        if (!token) {
          companyReviewForm.innerHTML = '<p class="p-muted">Login required to leave a company review.</p>';
        } else {
          companyReviewForm.addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
              const resp = await authFetch(`${API}/reviews/company/${job.company_id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  reviewer_name: companyReviewName?.value?.trim() || "",
                  reviewer_role: currentUser?.role || "job_seeker",
                  rating: Number(companyReviewRating?.value || 0),
                  message: companyReviewMessage?.value?.trim() || ""
                })
              });
              const data = await resp.json();
              if (!resp.ok) {
                showError(data.message || "Failed to submit review");
                return;
              }
              showSuccess(data.message || "Review submitted for approval");
              companyReviewForm.reset();
              if (companyReviewName && currentUser?.name) companyReviewName.value = currentUser.name;
              loadCompanyReviews(job.company_id, companyReviewsList);
            } catch (err) {
              console.error(err);
              showError("Failed to submit review");
            }
          });
        }
      }
    }
  } catch (err) {
    console.error(err);
    setMissingState("Job details unavailable");
  }
});

async function loadCompanyReviews(companyId, container) {
  if (!container || !companyId) return;

  container.innerHTML = '<p class="p-muted">Loading reviews...</p>';

  try {
    const res = await fetch(`${API}/reviews/company/${companyId}`);
    const reviews = await res.json();

    if (!res.ok || !Array.isArray(reviews) || !reviews.length) {
      container.innerHTML = '<p class="p-muted">No approved company reviews yet.</p>';
      return;
    }

    container.innerHTML = reviews
      .map((review) => {
        const name = review.reviewer_name || review.name || "Anonymous";
        const stars = "â˜…â˜…â˜…â˜…â˜…".slice(0, review.rating) + "â˜†â˜†â˜†â˜†â˜†".slice(0, 5 - review.rating);
        const created = review.created_at ? new Date(review.created_at).toLocaleDateString() : "";
        return `
          <article class="review-card" style="margin-bottom:12px;">
            <div class="review-header">
              <div>
                <h4>${escapeHtml(name)}</h4>
                ${created ? `<p class="meta">${escapeHtml(created)}</p>` : ""}
              </div>
              <span class="review-stars">${stars}</span>
            </div>
            <p class="review-message">${escapeHtml(review.message || "")}</p>
          </article>
        `;
      })
      .join("");
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="p-muted">Unable to load company reviews right now.</p>';
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const getCompanyInitials = (name = "Company") => {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "CO";
  const initials = words.slice(0, 2).map(word => word[0]?.toUpperCase() || "").join("");
  return initials || "CO";
};

const getJobTypeLabel = (job) => {
  if (job.is_shift) return "Shift";
  return job.job_type || job.jobType || job.category || "Full-Time";
};

const getSalaryLabel = (job) => {
  const salary = job.salary || job.salary_range || job.pay_range;
  if (salary) return String(salary);
  if (job.shift_pay_cents) return `$${(job.shift_pay_cents / 100).toFixed(2)}`;
  return "Competitive";
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

const getJobSearchState = () => {
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
  const state = getJobSearchState();

  let score = 62;
  const title = (job.title || "").toLowerCase();
  const location = (job.location || "").toLowerCase();
  const category = (job.category || "").toLowerCase();

  if (state.q && title.includes(state.q.toLowerCase())) score += 15;
  if (state.category && category === state.category.toLowerCase()) score += 10;
  if (state.location && location.includes(state.location.toLowerCase())) score += 8;
  if (state.remoteOnly && (location.includes("remote") || location.includes("hybrid"))) score += 8;
  if (job.is_premium) score += 3;
  if (job.is_shift) score += 4;

  return Math.min(98, Math.max(55, score));
};
