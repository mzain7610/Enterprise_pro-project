document.addEventListener("DOMContentLoaded", () => {
  const DRAFT_KEY = "jobPostDraft.v1";
  const PENDING_PREMIUM_JOB_KEY = "pendingPremiumJob.v1";
  const form = document.getElementById("jobForm");
  if (!form) return;

  const rawUser = localStorage.getItem("user");
  const token = localStorage.getItem("token");
  let currentUser = null;
  try {
    currentUser = rawUser ? JSON.parse(rawUser) : null;
  } catch (err) {
    currentUser = null;
  }

  if (!token || !currentUser) {
    showWarning("Please login first");
    window.location.href = "login.html";
    return;
  }

  const isEmployer = currentUser.role === "employer";
  const isAdmin = !!currentUser.is_admin || currentUser.role === "admin";
  if (!isEmployer && !isAdmin) {
    showError("Only employers or admins can post jobs");
window.location.href = "login.html";
    return;
  }

  const titleInput = document.getElementById("jobTitle");
  const descInput = document.getElementById("jobDescription");
  const locationInput = document.getElementById("location");
  const typeInput = document.getElementById("jobType");
  const categoryInput = document.getElementById("jobCategory");
  const categoryCustomWrap = document.getElementById("jobCategoryCustomWrap");
  const categoryCustomInput = document.getElementById("jobCategoryCustom");
  const salaryMinInput = document.getElementById("salaryMin");
  const salaryMaxInput = document.getElementById("salaryMax");
  const experienceLevelInput = document.getElementById("experienceLevel");
  const isRemoteInput = document.getElementById("isRemote");
  const benefitsInput = document.getElementById("benefits");
  const deadlineInput = document.getElementById("applicationDeadline");
  const premiumInput = document.getElementById("isPremium");
  const shiftInput = document.getElementById("isShift");
  const shiftFields = document.getElementById("shiftFields");
  const shiftStartInput = document.getElementById("shiftStart");
  const shiftEndInput = document.getElementById("shiftEnd");
  const shiftPayInput = document.getElementById("shiftPay");

  const readDraft = () => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.error("Invalid JSON in localStorage.jobPostDraft.v1", err);
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
  };

  const getDraftPayload = () => ({
    title: titleInput?.value || "",
    description: descInput?.value || "",
    location: locationInput?.value || "",
    job_type: typeInput?.value || "",
    category: categoryInput?.value || "",
    category_custom: categoryCustomInput?.value || "",
    salary_min: salaryMinInput?.value || "",
    salary_max: salaryMaxInput?.value || "",
    experience_level: experienceLevelInput?.value || "",
    is_remote: !!isRemoteInput?.checked,
    benefits: benefitsInput?.value || "",
    application_deadline: deadlineInput?.value || "",
    is_shift: !!shiftInput?.checked,
    shift_start: shiftStartInput?.value || "",
    shift_end: shiftEndInput?.value || "",
    shift_pay: shiftPayInput?.value || "",
    updated_at: new Date().toISOString()
  });

  const syncCustomCategoryField = () => {
    const isOther = (categoryInput?.value || "").toLowerCase() === "other";
    if (categoryCustomWrap) {
      categoryCustomWrap.style.display = isOther ? "block" : "none";
    }
    if (!isOther && categoryCustomInput) {
      categoryCustomInput.value = "";
    }
  };

  const resolveCategoryPayload = () => {
    const selectedCategory = (categoryInput?.value || "").trim();
    if (selectedCategory.toLowerCase() !== "other") {
      return { category: selectedCategory, category_custom: "" };
    }

    return {
      category: "Other",
      category_custom: (categoryCustomInput?.value || "").trim()
    };
  };

  const saveDraft = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(getDraftPayload()));
    } catch (err) {
      console.error(err);
    }
  };

  const restoreDraft = () => {
    const draft = readDraft();
    if (!draft) return;

    if (titleInput && !titleInput.value) titleInput.value = draft.title || "";
    if (descInput && !descInput.value) descInput.value = draft.description || "";
    if (locationInput && !locationInput.value) locationInput.value = draft.location || "";
    if (typeInput && !typeInput.value) typeInput.value = draft.job_type || "";
    if (categoryInput && !categoryInput.value) categoryInput.value = draft.category || "";
    if (categoryCustomInput && !categoryCustomInput.value) categoryCustomInput.value = draft.category_custom || "";
    if (salaryMinInput && !salaryMinInput.value) salaryMinInput.value = draft.salary_min || "";
    if (salaryMaxInput && !salaryMaxInput.value) salaryMaxInput.value = draft.salary_max || "";
    if (experienceLevelInput && !experienceLevelInput.value) experienceLevelInput.value = draft.experience_level || "";
    if (isRemoteInput) isRemoteInput.checked = !!draft.is_remote;
    if (benefitsInput && !benefitsInput.value) benefitsInput.value = draft.benefits || "";
    if (deadlineInput && !deadlineInput.value) deadlineInput.value = draft.application_deadline || "";

    if (shiftInput) shiftInput.checked = !!draft.is_shift;
    if (shiftFields) shiftFields.style.display = shiftInput?.checked ? "block" : "none";
    if (shiftStartInput && !shiftStartInput.value) shiftStartInput.value = draft.shift_start || "";
    if (shiftEndInput && !shiftEndInput.value) shiftEndInput.value = draft.shift_end || "";
    if (shiftPayInput && !shiftPayInput.value) shiftPayInput.value = draft.shift_pay || "";
    syncCustomCategoryField();
  };

  restoreDraft();
  categoryInput?.addEventListener("change", () => {
    syncCustomCategoryField();
    saveDraft();
  });
  categoryCustomInput?.addEventListener("input", saveDraft);

  const params = new URLSearchParams(window.location.search);
  const paymentStatus = params.get("payment");
  const sessionId = params.get("session_id");
  const mode = params.get("mode");
  const donationStatus = params.get("donation");
  const donationContext = params.get("context");

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

  const stashPendingPremiumJob = (jobData) => {
    const payload = {
      jobData,
      createdAt: Date.now()
    };

    const serialized = JSON.stringify(payload);
    sessionStorage.setItem("pendingPremiumJob", serialized);
    localStorage.setItem(PENDING_PREMIUM_JOB_KEY, serialized);
  };

  const loadPendingPremiumJob = () => {
    const raw = sessionStorage.getItem("pendingPremiumJob") || localStorage.getItem(PENDING_PREMIUM_JOB_KEY);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      const ageMs = Date.now() - Number(parsed.createdAt || 0);
      if (!parsed.jobData || !Number.isFinite(ageMs) || ageMs > 30 * 60 * 1000) {
        sessionStorage.removeItem("pendingPremiumJob");
        localStorage.removeItem(PENDING_PREMIUM_JOB_KEY);
        return null;
      }
      return parsed.jobData;
    } catch (_err) {
      sessionStorage.removeItem("pendingPremiumJob");
      localStorage.removeItem(PENDING_PREMIUM_JOB_KEY);
      return null;
    }
  };

  const clearPendingPremiumJob = () => {
    sessionStorage.removeItem("pendingPremiumJob");
    localStorage.removeItem(PENDING_PREMIUM_JOB_KEY);
  };

  const handleAuthFailure = () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(getDraftPayload()));
    } catch (_err) {
      // ignore storage failures
    }
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    showSuccess("Your session expired or token became invalid. We saved your draft. Please login again.");
    window.location.href = "login.html?redirect=post-jobs.html";
  };

  if (donationStatus && donationContext === "post") {
    if (donationStatus === "success" && sessionId) {
      authFetch(`${API}/payments/confirm`, {
        method: "POST",
        body: JSON.stringify({ sessionId, mode: "donation" })
      }).then(() => {
        showError("Thanks for your support! âœ…");
        window.history.replaceState({}, document.title, "post-jobs.html");
      });
    }

    if (donationStatus === "cancel") {
      showError("Donation canceled.");
      window.history.replaceState({}, document.title, "post-jobs.html");
    }
  }

  if (paymentStatus === "success" && mode === "create" && sessionId) {
    const jobData = loadPendingPremiumJob();
    if (jobData) {
      authFetch(`${API}/payments/confirm`, {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          mode: "create",
          jobData
        })
      }).then(async (res) => {
        const data = await readResponsePayload(res);
        if (!res.ok) {
          if (res.status === 401) {
            localStorage.removeItem("token");
            localStorage.removeItem("user");
            showError("Your session expired during payment confirmation. Please login again.");
            window.location.href = "login.html?redirect=post-jobs.html";
            return;
          }
          showError(data.message || "Payment confirmation failed");
          return;
        }
        clearPendingPremiumJob();
        localStorage.removeItem(DRAFT_KEY);
        showSuccess("Premium job created successfully âœ…");
        window.history.replaceState({}, document.title, "post-jobs.html");
      });
    } else {
      showError("Premium payment succeeded, but job details were missing. Please create the premium job again.");
      window.history.replaceState({}, document.title, "post-jobs.html");
    }
  }

  if (paymentStatus === "cancel" && mode === "create") {
    showError("Premium payment was canceled.");
    window.history.replaceState({}, document.title, "post-jobs.html");
  }

  const donationModal = document.getElementById("donationModal");
const postPaymentModal = document.getElementById("postPaymentModal");
  let pendingPremiumJob = null;
  let donationContextMode = "post";
  let selectedPaymentMethod = "card";

  const PAYMENT_LABELS = {
    card: "Card",
    applepay: "Apple Pay",
    gpay: "Google Pay",
    paypal: "PayPal",
    bank_transfer: "Bank Transfer"
  };

  const getPaymentButtons = () => Array.from(document.querySelectorAll("#postPaymentOptions .payment-method-option"));

  const isAppleDevice = () => {
    const ua = String(navigator.userAgent || "").toLowerCase();
    const platform = String(navigator.platform || "").toLowerCase();
    return /iphone|ipad|ipod|macintosh|mac os/.test(ua) || /mac/.test(platform);
  };

  const applyPaymentMethodAvailability = () => {
    const applePayButton = document.querySelector('#postPaymentOptions .payment-method-option[data-method="applepay"]');
    if (!applePayButton) return;

    if (!isAppleDevice()) {
      applePayButton.classList.add("is-disabled");
      applePayButton.setAttribute("aria-disabled", "true");
      applePayButton.setAttribute("title", "Apple Pay is only supported on Apple devices and Safari.");
      applePayButton.style.opacity = "0.55";
      applePayButton.style.pointerEvents = "none";

      if (selectedPaymentMethod === "applepay") {
        setPaymentSelection("card");
      }
    }
  };

  applyPaymentMethodAvailability();

  const setPaymentSelection = (method, { focus = false } = {}) => {
    const selectedText = document.getElementById("postPaymentSelectedText");
    getPaymentButtons().forEach((btn) => {
      const isSelected = btn.dataset.method === method;
      btn.classList.toggle("is-selected", isSelected);
      btn.setAttribute("aria-selected", isSelected ? "true" : "false");
      btn.setAttribute("tabindex", isSelected ? "0" : "-1");
      if (isSelected && focus) btn.focus();
    });
    if (selectedText) selectedText.textContent = `Selected: ${PAYMENT_LABELS[method] || method}`;
    selectedPaymentMethod = method;
  };

  let resolvePaymentChoice = null;
  const openPaymentModal = () => new Promise((resolve) => {
    resolvePaymentChoice = resolve;
    postPaymentModal?.classList.remove("hidden");
    setPaymentSelection(selectedPaymentMethod || "card");
  });
  const closePaymentModal = (method) => {
    postPaymentModal?.classList.add("hidden");
    if (resolvePaymentChoice) {
      resolvePaymentChoice(method || null);
      resolvePaymentChoice = null;
    }
  };

  const getSelectedPaymentMethod = () => {
    const method = (postPaymentMethodSelect?.value || "card").trim();
    return method || "card";
  };

  const openDonationModal = (context) => {
    donationContextMode = context;
    donationModal?.classList.remove("hidden");
  };

  const closeDonationModal = () => {
    donationModal?.classList.add("hidden");
  };

  const startDonation = async (amountCents) => {
    if (!amountCents || amountCents <= 0) {
      closeDonationModal();
      if (donationContextMode === "premium" && pendingPremiumJob) {
        await startPremiumCheckout(0);
      }
      return;
    }

    if (donationContextMode === "premium" && pendingPremiumJob) {
      await startPremiumCheckout(amountCents);
      return;
    }

    const paymentMethod = await openPaymentModal();
    if (!paymentMethod) {
      return;
    }

    try {
      const res = await authFetch(`${API}/payments/create-donation-session`, {
        method: "POST",
body: JSON.stringify({ context: "post", amount_cents: amountCents, payment_method: selectedPaymentMethod })
      });
      const data = await readResponsePayload(res);
      if (res.status === 401) {
        handleAuthFailure();
        return;
      }
      if (!res.ok || !data?.url) {
        showError(data.message || "Donation failed");
        closeDonationModal();
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      showError("Donation failed");
      closeDonationModal();
    }
  };

  const startPremiumCheckout = async (donationCents) => {
    stashPendingPremiumJob(pendingPremiumJob);

try {
      const meRes = await authFetch(`${API}/users/me`);
      if (meRes.status === 401) {
        handleAuthFailure();
        return;
      }

      const res = await authFetch(`${API}/payments/create-checkout-session`, {
        method: "POST",
        body: JSON.stringify({ mode: "create", donation_cents: donationCents, payment_method: selectedPaymentMethod })
      });

      const data = await readResponsePayload(res);
      if (res.status === 401) {
        const reason = String(data?.message || "");
        if (reason) {
          showError(`Payment session failed: ${reason}`);
        }
        handleAuthFailure();
        return;
      }

      if (res.status === 409) {
        showError(data?.message || "A similar active job already exists. Please edit the existing job instead of reposting.");
        closeDonationModal();
        return;
      }

      if (!res.ok || !data?.url) {
        showError(data?.message || "Failed to start payment");
        closeDonationModal();
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      showError("Failed to start payment. Please try again.");
      closeDonationModal();
    }
  };

  donationModal?.addEventListener("click", (event) => {
    if (event.target.id === "donationModal") {
      closeDonationModal();
    }
    const amount = event.target.getAttribute("data-amount");
    if (amount !== null) {
      startDonation(Number(amount));
    }
  });

  document.addEventListener("click", (event) => {
    const option = event.target.closest("#postPaymentOptions .payment-method-option");
    if (option) {
      setPaymentSelection(option.dataset.method, { focus: true });
      return;
    }

    if (event.target.closest("#postPaymentConfirm")) {
      closePaymentModal(selectedPaymentMethod || "card");
      return;
    }

    if (event.target.closest("#postPaymentCancel")) {
      closePaymentModal(null);
    }
  });

  shiftInput?.addEventListener("change", () => {
    if (!shiftFields) return;
    shiftFields.style.display = shiftInput.checked ? "block" : "none";
    document.body.classList.toggle("post-shift-active", !!shiftInput.checked);
    saveDraft();
  });

  if (shiftInput) {
    document.body.classList.toggle("post-shift-active", !!shiftInput.checked);
  }

  [
    titleInput,
    descInput,
    locationInput,
    typeInput,
    categoryInput,
    salaryMinInput,
    salaryMaxInput,
    experienceLevelInput,
    isRemoteInput,
    benefitsInput,
    deadlineInput,
    shiftStartInput,
    shiftEndInput,
    shiftPayInput
  ].forEach((field) => {
    field?.addEventListener("input", saveDraft);
    field?.addEventListener("change", saveDraft);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const jobData = {
      title: titleInput.value.trim(),
      description: descInput.value.trim(),
      location: locationInput.value.trim(),
      job_type: typeInput ? typeInput.value.trim() : "Full-time",
      salary_min: salaryMinInput && salaryMinInput.value ? Number(salaryMinInput.value) : null,
      salary_max: salaryMaxInput && salaryMaxInput.value ? Number(salaryMaxInput.value) : null,
      experience_level: experienceLevelInput ? experienceLevelInput.value.trim() : "",
      is_remote: !!isRemoteInput?.checked,
      benefits: benefitsInput ? benefitsInput.value.trim() : "",
      application_deadline: deadlineInput ? deadlineInput.value : ""
    };

    const resolvedCategory = resolveCategoryPayload();
    if (!resolvedCategory.category) {
      showWarning("Please select a category");
      return;
    }
    if (resolvedCategory.category.toLowerCase() === "other" && !resolvedCategory.category_custom) {
      showWarning("Please enter a custom category");
      categoryCustomInput?.focus();
      return;
    }

    jobData.category = resolvedCategory.category;
    jobData.category_custom = resolvedCategory.category_custom;

    if (shiftInput && shiftInput.checked) {
      const shiftStart = shiftStartInput?.value || "";
      const shiftEnd = shiftEndInput?.value || "";
      const shiftPay = Number(shiftPayInput?.value || 0);

      if (!shiftStart || !shiftEnd || !shiftPay) {
        showWarning("Shift start, end, and pay are required");
        return;
      }

      jobData.is_shift = true;
      jobData.shift_start = shiftStart;
      jobData.shift_end = shiftEnd;
      jobData.shift_pay_cents = Math.round(shiftPay * 100);
    }

    if (!jobData.title || !jobData.description || !jobData.location) {
      showWarning("Please fill out all required fields");
      return;
    }

    if (premiumInput && premiumInput.checked) {
      const paymentMethod = await openPaymentModal();
      if (!paymentMethod) return;
      pendingPremiumJob = jobData;
      openDonationModal("premium");
      return;
    }

    try {
      console.log("Submitting job data:", jobData);
      const imageFile = document.getElementById("jobImage")?.files?.[0] ?? null;
      let res;
      if (imageFile) {
        const token = localStorage.getItem("token");
        const fd = new FormData();
        Object.entries({ ...jobData, is_premium: false }).forEach(([k, v]) => {
          if (v != null) fd.append(k, String(v));
        });
        fd.append("job_image", imageFile);
        res = await fetch(`${API}/jobs`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
      } else {
        const imageUrlInput = (document.getElementById("jobImageUrl")?.value || "").trim();
        res = await authFetch(`${API}/jobs`, {
          method: "POST",
          body: JSON.stringify({
            ...jobData,
            is_premium: false,
            ...(imageUrlInput ? { image_url: imageUrlInput } : {})
          })
        });
      }

      console.log("API Response status:", res.status);
      const data = await res.json();
      console.log("API Response data:", data);

      if (!res.ok) {
        if (res.status === 403 && data.message && data.message.toLowerCase().includes("verification")) {
          // Show persistent verification banner instead of alert
          let banner = document.getElementById("verificationBanner");
          if (!banner) {
            banner = document.createElement("div");
            banner.id = "verificationBanner";
            banner.style.cssText = "background:#fef9c3;border:1px solid #fde047;color:#713f12;padding:16px 20px;border-radius:10px;margin-bottom:20px;font-size:0.95rem;line-height:1.6;";
            form.parentNode.insertBefore(banner, form);
          }
          banner.innerHTML = `<strong>âš ï¸ Account not yet verified</strong><br>${data.message}`;
          banner.scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          showError(data.message || "Failed to post job");
        }
        console.error("Job submission error:", data);
        return;
      }

      showSuccess("Job posted successfully âœ…");
      form.reset();
      localStorage.removeItem(DRAFT_KEY);
      if (shiftFields) shiftFields.style.display = "none";
      openDonationModal("post");
    } catch (err) {
      console.error("Job submission error:", err);
      showError("Error posting job: " + err.message);
    }
  });
});
