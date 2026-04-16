(() => {
  const uiToken = localStorage.getItem("token");
  const rawUser = localStorage.getItem("user");
  let uiUser = null;
  if (rawUser) {
    try {
      uiUser = JSON.parse(rawUser);
    } catch (err) {
      console.error("Invalid JSON in localStorage.user", err);
      localStorage.removeItem("user");
    }
  }

  const loginLink = document.getElementById("loginLink");
  const logoutBtn = document.getElementById("logoutBtn");
  const userInfo = document.getElementById("userInfo");
  const adminLink = document.getElementById("adminLink");
  const postJobLink = document.getElementById("postJobLink");
  const dashboardLink = document.getElementById("dashboardLink");
  const menuLink = document.getElementById("menuLink");
  const profileLink = document.getElementById("profileLink");
  const navBar = document.querySelector(".navbar");
  let shiftBadge = null;
  let bellLink = document.getElementById("shiftBell");
  let supportBadge = null;
  let supportLink = document.getElementById("supportBell");

  // DEFAULT: hide admin + post job
  if (adminLink) adminLink.style.display = "none";
  if (postJobLink) postJobLink.style.display = "none";
  if (dashboardLink) dashboardLink.style.display = "none";
  if (profileLink) profileLink.style.display = "none";

  if (uiToken && uiUser) {
    // Logged in
    if (loginLink) loginLink.style.display = "none";

    if (logoutBtn) logoutBtn.classList.remove("hidden");
    if (dashboardLink) dashboardLink.style.display = "inline-block";
    if (profileLink) profileLink.style.display = "inline-block";
    if (userInfo) {
      userInfo.classList.remove("hidden");
      userInfo.innerText = `👤 ${uiUser.name || uiUser.email}`;
    }

    const profileChip = document.querySelector("a.nav-profile-chip");
    if (profileChip) {
      const avatar = profileChip.querySelector(".nav-profile-avatar");
      const photo = uiUser.photoUrl || uiUser.photo_url || uiUser.avatarUrl || uiUser.photoData || "";
      if (photo) {
        const resolvedPhoto = photo.startsWith("http") || photo.startsWith("data:") ? photo : `${window.API?.replace(/\/api$/, "") || ""}${photo}`;
        if (avatar) {
          avatar.innerHTML = `<img src="${resolvedPhoto}" alt="Profile" />`;
        }
      } else if (avatar) {
        avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
      }
    }

    // Admin only
    if (uiUser.is_admin) {
      if (adminLink) adminLink.style.display = "inline-block";
    }

    // Employers (and admins) can post jobs
    if (uiUser.is_admin || uiUser.role === "employer") {
      if (postJobLink) postJobLink.style.display = "inline-block";
    }

    if (dashboardLink) {
      if (!bellLink) {
        bellLink = document.createElement("a");
        bellLink.id = "shiftBell";
        bellLink.href = "dashboard.html#shift-alerts";
        bellLink.className = "nav-bell";
        bellLink.setAttribute("aria-label", "Shift alerts");
        bellLink.innerHTML = '<span class="nav-bell-icon"><i class="fa-solid fa-bell"></i></span>';

        shiftBadge = document.createElement("span");
        shiftBadge.className = "nav-badge hidden";
        shiftBadge.textContent = "0";
        bellLink.appendChild(shiftBadge);

        if (navBar) {
          // Insert before theme toggle button
          const themeToggle = navBar.querySelector("#themeToggle");
          if (themeToggle) {
            themeToggle.insertAdjacentElement("beforebegin", bellLink);
          } else {
            navBar.appendChild(bellLink);
          }
        } else {
          dashboardLink.insertAdjacentElement("afterend", bellLink);
        }
      } else {
        shiftBadge = bellLink.querySelector(".nav-badge");
        if (navBar && !navBar.contains(bellLink)) {
          const themeToggle = navBar.querySelector("#themeToggle");
          if (themeToggle) {
            themeToggle.insertAdjacentElement("beforebegin", bellLink);
          } else {
            navBar.appendChild(bellLink);
          }
        }
      }

      bellLink.style.display = "inline-flex";
    }

    // Keep a single chat entry point: floating widget in the bottom-right.
    if (supportLink) {
      supportBadge = supportLink.querySelector(".nav-badge");
      supportLink.style.display = "none";
    }
  } else {
    // Not logged in
    if (loginLink) loginLink.style.display = "inline-block";
    if (logoutBtn) logoutBtn.classList.add("hidden");
    if (userInfo) userInfo.classList.add("hidden");
    if (profileLink) profileLink.style.display = "none";
    if (bellLink) bellLink.style.display = "none";
    if (supportLink) supportLink.style.display = "none";
  }

  const isLoggedIn = !!(uiToken && uiUser);
  const canPostJobs = !!(isLoggedIn && (uiUser.is_admin || uiUser.role === "admin" || uiUser.role === "employer"));
  const canAccessAdmin = !!(isLoggedIn && (uiUser.is_admin || uiUser.role === "admin"));
  const isEmployerUser = !!(isLoggedIn && (uiUser.role === "employer" || uiUser.role === "admin" || uiUser.is_admin));
  const authOnlyPages = new Set(["dashboard.html", "profile.html", "menu.html"]);

  const resolvePageName = (href) => {
    if (!href) return "";
    try {
      const url = new URL(href, window.location.href);
      const path = url.pathname || "";
      const parts = path.split("/").filter(Boolean);
      return (parts[parts.length - 1] || "").toLowerCase();
    } catch {
      return "";
    }
  };

  Array.from(document.querySelectorAll("a[href]")).forEach((anchor) => {
    const pageName = resolvePageName(anchor.getAttribute("href"));
    if (!pageName) return;

    anchor.addEventListener("click", (event) => {
      if (authOnlyPages.has(pageName) && !isLoggedIn) {
        event.preventDefault();
        showWarning("Please login first");
        window.location.href = "login.html";
        return;
      }

      if (pageName === "post-jobs.html" && !canPostJobs) {
        event.preventDefault();
        showError("You need to login as employer or admin to post jobs");
        window.location.href = "login.html";
        return;
      }

      if (pageName === "employer.html" && !isEmployerUser) {
        event.preventDefault();
        showError("This page is for employers only");
        window.location.href = "dashboard.html";
        return;
      }

      if (pageName === "dashboard.html" && isEmployerUser && !uiUser.is_admin && uiUser.role !== "job_seeker") {
        event.preventDefault();
        window.location.href = "employer.html";
        return;
      }

      if (pageName === "admin.html" && !canAccessAdmin) {
        event.preventDefault();
        showError("You need to login as admin to access this page");
        window.location.href = "login.html";
      }
    });
  });

  const refreshShiftBadge = async () => {
    if (!uiToken || !shiftBadge || !window.API) return;

    const request = window.authFetch
      ? window.authFetch
      : (url, options = {}) => {
          return fetch(url, {
            ...options,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${uiToken}`
            }
          });
        };

    try {
      const res = await request(`${API}/job-alerts/shift-notifications`);
      const data = await res.json();
      if (!res.ok) return;
      const unread = (data || []).filter(item => !item.is_read).length;
      if (unread > 0) {
        shiftBadge.textContent = String(unread);
        shiftBadge.classList.remove("hidden");
      } else {
        shiftBadge.textContent = "0";
        shiftBadge.classList.add("hidden");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const refreshSupportBadge = async () => {
    if (!uiToken || !supportBadge || !window.API) return;

    const request = window.authFetch
      ? window.authFetch
      : (url, options = {}) => {
          return fetch(url, {
            ...options,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${uiToken}`
            }
          });
        };

    try {
      const res = await request(`${API}/chat/live-support/unread-count`);
      const data = await res.json();
      if (!res.ok) return;
      const unread = Number(data?.unread || 0);
      if (unread > 0) {
        supportBadge.textContent = String(unread > 99 ? "99+" : unread);
        supportBadge.classList.remove("hidden");
      } else {
        supportBadge.textContent = "0";
        supportBadge.classList.add("hidden");
      }
    } catch (err) {
      console.error(err);
    }
  };

  // LOGOUT
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "index.html";
    });
  }

  if (uiToken && uiUser) {
    refreshShiftBadge();
    refreshSupportBadge();
    setInterval(refreshShiftBadge, 60000);
    setInterval(refreshSupportBadge, 30000);
  }

  const oauthContainer = document.getElementById("oauthProviders");
  if (oauthContainer) {
    fetch(`${API}/auth/providers`)
      .then((res) => res.json())
      .then((providers) => {
        const actions = [];

        if (providers?.google) {
          actions.push(`
            <button class="btn btn-outline" type="button" data-oauth-provider="google" style="width:100%;display:flex;justify-content:center;align-items:center;gap:10px;">
              <i class="fa-brands fa-google"></i>
              Continue with Google
            </button>
          `);
        }

        if (!actions.length) {
          oauthContainer.innerHTML = "";
          return;
        }

        oauthContainer.innerHTML = `
          <div class="p-muted" style="text-align:center;margin:4px 0 12px;">Or continue with</div>
          ${actions.join("")}
        `;

        oauthContainer.querySelectorAll("[data-oauth-provider]").forEach((button) => {
          button.addEventListener("click", () => {
            const provider = button.getAttribute("data-oauth-provider");
            window.location.href = `${API}/auth/${provider}`;
          });
        });
      })
      .catch((err) => {
        console.error("Failed to load auth providers", err);
        oauthContainer.innerHTML = "";
      });
  }
})();
