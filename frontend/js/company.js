document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("companyForm");
  const preview = document.getElementById("companyPreview");
  const modeLabel = document.getElementById("companyMode");
  const shareLabel = document.getElementById("companyShare");
  const editor = document.getElementById("companyEditor");
  const companyReviewsSection = document.getElementById("companyReviewsSection");
  const companyReviewsGrid = document.getElementById("companyReviewsGrid");
  const companyReviewForm = document.getElementById("companyReviewForm");

  // If viewing as a public company profile (has ?companyId= param), allow anyone.
  // Otherwise only employers/admins can edit.
  const params = new URLSearchParams(window.location.search);
  const publicCompanyId = params.get("companyId");
  if (!publicCompanyId) {
    const token = localStorage.getItem("token");
    if (!token) {
      showWarning("Login required");
      window.location.href = "login.html";
      return;
    }
    try {
      const u = JSON.parse(localStorage.getItem("user") || "{}");
      if (!u.is_admin && u.role !== "employer") {
        showError("Company profiles are managed by employers.");
        window.location.href = "dashboard.html";
        return;
      }
    } catch (e) { /* ignore */ }
  }

  const fields = {
    name: document.getElementById("companyName"),
    phone: document.getElementById("companyPhone"),
    website: document.getElementById("companyWebsite"),
    location: document.getElementById("companyLocation"),
    address: document.getElementById("companyAddress"),
    size: document.getElementById("companySize"),
    industry: document.getElementById("companyIndustry"),
    founded: document.getElementById("companyFounded"),
    logo_url: document.getElementById("companyLogo"),
    registration: document.getElementById("companyRegistration"),
    linkedin: document.getElementById("companyLinkedIn"),
    taxId: document.getElementById("companyTaxId"),
    description: document.getElementById("companyDescription")
  };

  let currentCompany = null;

  const esc = (value) => String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const renderCompanyReviews = (reviews = []) => {
    if (!companyReviewsGrid) return;

    if (!reviews.length) {
      companyReviewsGrid.innerHTML = '<p class="p-muted">No public reviews yet.</p>';
      return;
    }

    companyReviewsGrid.innerHTML = reviews.map((review) => {
      const stars = "★★★★★".slice(0, review.rating) + "☆☆☆☆☆".slice(0, 5 - review.rating);
      const verifiedBadge = Number(review.verified_review) === 1
        ? '<span style="display:inline-block;margin-top:6px;padding:2px 8px;border-radius:999px;background:#dcfce7;color:#166534;border:1px solid #86efac;font-size:12px;font-weight:600;">Verified candidate review</span>'
        : "";
      return `
        <article class="review-card">
          <div class="review-header">
            <div>
              <h3>${esc(review.name)}</h3>
              <p class="meta">${esc(review.role)}</p>
              ${verifiedBadge}
            </div>
            <span class="review-stars">${stars}</span>
          </div>
          <p class="review-message">${esc(review.message)}</p>
        </article>
      `;
    }).join("");
  };

  const loadCompanyReviews = async (companyId) => {
    if (!companyId || !companyReviewsGrid) return;
    try {
      const res = await fetch(`${API}/reviews/company/${companyId}?limit=10`);
      const data = await res.json().catch(() => []);
      renderCompanyReviews(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      renderCompanyReviews([]);
    }
  };

  const bindCompanyReviewForm = (companyId) => {
    if (!companyReviewForm || !companyId) return;

    companyReviewForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const token = localStorage.getItem("token");
      if (!token) {
        showWarning("Login required to submit a review.");
        window.location.href = "login.html";
        return;
      }

      const role = (document.getElementById("companyReviewRole")?.value || "").trim();
      const rating = Number(document.getElementById("companyReviewRating")?.value || 0);
      const message = (document.getElementById("companyReviewMessage")?.value || "").trim();
      const jobIdParam = Number(new URLSearchParams(window.location.search).get("jobId") || 0);

      if (!role || !rating || !message) {
        showError("Please complete all review fields.");
        return;
      }

      try {
        const payload = { role, rating, message };
        if (jobIdParam > 0) payload.job_id = jobIdParam;

        const res = await authFetch(`${API}/reviews/company/${companyId}`, {
          method: "POST",
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showError(data.message || "Failed to submit company review.");
          return;
        }

        companyReviewForm.reset();
        if (window.toast) {
          toast("Thanks! Your company review is pending approval.");
        } else {
          showError("Thanks! Your company review is pending approval.");
        }
      } catch (err) {
        console.error(err);
        showError("Network error while submitting review.");
      }
    });
  };

  const renderPreview = (data) => {
    if (!preview) return;

    if (!data) {
      preview.innerHTML = "<p class=\"p-muted\">Add details to see a preview.</p>";
      return;
    }

    const logo = data.logo_url
      ? `<img class=\"company-logo\" src=\"${data.logo_url}\" alt=\"${data.name}\" />`
      : "";

    preview.innerHTML = `
      <div class="company-preview-card">
        ${logo}
        <h3>${data.name || ""}</h3>
        <p class="p-muted">${data.industry || ""}${data.industry && data.location ? " â€¢ " : ""}${data.location || ""}</p>
        <div class="company-meta">
          ${data.website ? `<a href="${data.website}" target="_blank">${data.website}</a>` : ""}
          ${data.size ? `<span>${data.size}</span>` : ""}
        </div>
        ${data.phone ? `<p class="p-muted">Phone: ${data.phone}</p>` : ""}
        ${data.address ? `<p class="p-muted">Address: ${data.address}</p>` : ""}
        ${data.founded ? `<p class="p-muted">Founded: ${data.founded}</p>` : ""}
        <p>${data.description || ""}</p>
      </div>
    `;
  };

  const setForm = (data) => {
    if (!data) return;
    fields.name.value = data.name || "";
    if (fields.phone) fields.phone.value = data.phone || "";
    fields.website.value = data.website || "";
    fields.location.value = data.location || "";
    if (fields.address) fields.address.value = data.address || "";
    fields.size.value = data.size || "";
    fields.industry.value = data.industry || "";
    if (fields.founded) fields.founded.value = data.founded || "";
    fields.logo_url.value = data.logo_url || "";
    if (fields.registration) fields.registration.value = data.registration || "";
    if (fields.linkedin) fields.linkedin.value = data.linkedin || "";
    if (fields.taxId) fields.taxId.value = data.taxId || "";
    fields.description.value = data.description || "";
  };

  const getPayload = () => {
    return {
      name: fields.name.value.trim(),
      website: fields.website.value.trim(),
      location: fields.location.value.trim(),
      size: fields.size.value.trim(),
      industry: fields.industry.value.trim(),
      logo_url: fields.logo_url.value.trim(),
      description: fields.description.value.trim()
    };
  };

  const getEmployerPayload = () => {
    return {
      company_name: fields.name.value.trim(),
      company_phone: fields.phone?.value.trim() || "",
      company_address: fields.address?.value.trim() || "",
      company_location: fields.location.value.trim(),
      website: fields.website.value.trim(),
      industry: fields.industry.value.trim(),
      company_size: fields.size.value.trim(),
      founded_year: fields.founded?.value.trim() || "",
      description: fields.description.value.trim(),
      registration_number: fields.registration?.value.trim() || "",
      linkedin_url: fields.linkedin?.value.trim() || "",
      tax_id: fields.taxId?.value.trim() || ""
    };
  };

  const updatePreviewFromForm = () => {
    const company = getPayload();
    const employer = getEmployerPayload();
    renderPreview({
      ...company,
      phone: employer.company_phone,
      address: employer.company_address,
      founded: employer.founded_year
    });
  };

  if (publicCompanyId) {
    if (editor) editor.style.display = "none";
    if (modeLabel) modeLabel.textContent = "Public company profile";
    if (shareLabel) shareLabel.textContent = "";
    if (companyReviewsSection) companyReviewsSection.style.display = "block";

    try {
      const res = await fetch(`${API}/companies/${publicCompanyId}`);
      const data = await res.json();
      if (!res.ok) {
        renderPreview(null);
        if (modeLabel) modeLabel.textContent = data.message || "Company not found";
        return;
      }
      renderPreview(data);
      await loadCompanyReviews(Number(publicCompanyId));
      bindCompanyReviewForm(Number(publicCompanyId));
    } catch (err) {
      console.error(err);
      renderPreview(null);
      if (modeLabel) modeLabel.textContent = "Failed to load company profile";
    }

    return;
  }

  const token = localStorage.getItem("token");
  if (!token) {
    showWarning("Login required");
    window.location.href = "login.html";
    return;
  }

  if (companyReviewsSection) {
    companyReviewsSection.style.display = "none";
  }

  const loadMyCompany = async () => {
    try {
      const res = await authFetch(`${API}/companies/me`);
      const data = await res.json();

      if (!res.ok) {
        if (modeLabel) modeLabel.textContent = "Create your company profile";
        renderPreview(null);
        return;
      }

      currentCompany = data;
      setForm(data);
      renderPreview(data);
      if (modeLabel) modeLabel.textContent = "Edit your company profile";

      if (shareLabel && data?.id) {
        shareLabel.textContent = `Public link: ${window.location.origin}/company.html?companyId=${data.id}`;
      }
    } catch (err) {
      console.error(err);
      if (modeLabel) modeLabel.textContent = "Failed to load company profile";
      renderPreview(null);
    }
  };

  const loadEmployerProfile = async () => {
    try {
      const res = await authFetch(`${API}/users/employer-profile`);
      const data = await res.json();
      if (!res.ok || !data) return;

      setForm({
        name: data.company_name || fields.name.value,
        phone: data.company_phone || "",
        website: data.website || fields.website.value,
        location: data.company_location || fields.location.value,
        address: data.company_address || "",
        size: data.company_size || fields.size.value,
        industry: data.industry || fields.industry.value,
        founded: data.founded_year || "",
        logo_url: fields.logo_url.value,
        registration: data.registration_number || "",
        linkedin: data.linkedin_url || "",
        taxId: data.tax_id || "",
        description: data.description || fields.description.value
      });
    } catch (err) {
      console.error(err);
    }
  };

  await loadMyCompany();
  await loadEmployerProfile();

  form?.addEventListener("input", updatePreviewFromForm);

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = getPayload();
    if (!payload.name) {
      showWarning("Company name is required");
      return;
    }

    const employerPayload = getEmployerPayload();

    try {
      const res = await authFetch(`${API}/companies${currentCompany ? "/me" : ""}`, {
        method: currentCompany ? "PUT" : "POST",
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        showError(data.message || "Failed to save company profile");
        return;
      }

      const employerRes = await authFetch(`${API}/users/employer-profile`, {
        method: "PUT",
        body: JSON.stringify(employerPayload)
      });

      const employerData = await employerRes.json();
      if (!employerRes.ok) {
        showError(employerData.message || "Failed to save employer profile");
        return;
      }

      if (window.toast) {
        toast(currentCompany ? "Company updated" : "Company created");
      } else {
        showSuccess(currentCompany ? "Company updated" : "Company created");
      }
      await loadMyCompany();
      await loadEmployerProfile();
    } catch (err) {
      console.error(err);
      showError("Failed to save company profile");
    }
  });
});
