function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) { console.info("[toast]", msg); return; }
  t.innerText = msg;
  t.style.display = "block";
  setTimeout(() => { t.style.display = "none"; }, 2500);
}

/* Escape HTML â€” use on every user-supplied value in innerHTML to prevent XSS */
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeParseJson(value, label) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (err) {
    console.error(`Invalid JSON for ${label || "value"}`, err);
    return null;
  }
}

/* ðŸ” authFetch: defined in config.js as a var â€” available globally.
   Do not redefine here. If config.js is not loaded, define a basic fallback. */
if (typeof authFetch === "undefined") {
  const handleAuthFailure = (res) => {
    if ((res.status === 401 || res.status === 403) && typeof window !== "undefined") {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (!window.location.href.includes("login.html")) {
        window.location.href = "login.html";
      }
    }
    return res;
  };

  // eslint-disable-next-line no-var
  var authFetch = function(url, options = {}) {
    const token = localStorage.getItem("token");
    const isFormData = options.body instanceof FormData;
    const method = String(options.method || "GET").toUpperCase();
    const shouldSetJsonHeader = !isFormData && !["GET", "HEAD"].includes(method);
    return fetch(url, {
      ...options,
      headers: {
        ...(shouldSetJsonHeader ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {})
      }
    }).then(handleAuthFailure);
  };
}

/* ðŸšª Logout */
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "login.html";
});


/* ðŸ‘¤ Get logged user */
function getUser() {
  const raw = localStorage.getItem("user");
  const user = safeParseJson(raw, "localStorage.user");
  if (!user && raw) {
    localStorage.removeItem("user");
  }
  return user;
}

// Remember last job ID from job-related links (apply/details)
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href]");
  if (!link) return;

  const href = link.getAttribute("href") || "";
  if (!/jobId=\d+/i.test(href) && !link.classList.contains("apply-btn")) {
    return;
  }

  const dataId = link.getAttribute("data-job-id");

  if (dataId) {
    sessionStorage.setItem("lastJobId", dataId);
    return;
  }

  const match = href.match(/[?&]jobId=(\d+)/);
  if (match) {
    sessionStorage.setItem("lastJobId", match[1]);
    return;
  }

  const fallbackMatch = href.match(/[?&]id=(\d+)/);
  if (fallbackMatch) {
    sessionStorage.setItem("lastJobId", fallbackMatch[1]);
  }
});

const exploreJobsBtn = document.getElementById("exploreJobsBtn");
if (exploreJobsBtn) {
  exploreJobsBtn.addEventListener("click", () => {
    window.location.href = "jobs.html";
  });
}
