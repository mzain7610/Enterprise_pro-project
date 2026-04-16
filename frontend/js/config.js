const apiPort = "3000";

const getDefaultApiOrigin = () => {
  if (window.location.protocol === "file:") {
    return `http://localhost:${apiPort}`;
  }

  const host = window.location.hostname || "localhost";
  const isLocalHost = ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host);

  if (isLocalHost) {
    return `http://localhost:${apiPort}`;
  }

  // Use same host for production deployments where backend and frontend share origin
  return `${window.location.protocol}//${window.location.host}`;
};

// Base origin for asset URLs (images, uploads, etc.) â€” no /api suffix
const apiOrigin = getDefaultApiOrigin();
const API = `${apiOrigin}/api`;

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
  // Do NOT set Content-Type for FormData â€” browser must set it with the multipart boundary
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
window.authFetch = authFetch;
