document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("supportWidget")) return;

  const widget = document.createElement("div");
  widget.id = "supportWidget";
  widget.innerHTML = `
    <div class="support-toggle-wrap">
      <button id="supportToggle" class="support-toggle" type="button" aria-label="Open support chat"><i class="fa-solid fa-robot"></i></button>
      <span id="supportUnreadBadge" class="support-unread-badge hidden">0</span>
    </div>
    <div id="supportPanel" class="support-panel hidden">
      <div class="support-header">
        <div>
          <strong>AI Support (beta)</strong>
          <div id="supportStatus" class="p-muted">Checking AI status...</div>
        </div>
        <button id="supportClose" class="btn btn-outline" type="button">Close</button>
      </div>
      <div class="support-quick">
        <button class="btn btn-outline" data-quick="How do I apply?">Apply</button>
        <button class="btn btn-outline" data-quick="How do I post a job?">Post job</button>
        <button class="btn btn-outline" data-quick="What is premium?">Premium</button>
        <button class="btn btn-outline" data-quick="My payment is stuck">Payment help</button>
        <button class="btn btn-outline" data-quick="How do I update my profile?">Profile</button>
        <button class="btn btn-outline" id="supportLiveBtn" type="button">Talk to human</button>
      </div>
      <div id="supportMessages" class="support-messages"></div>
      <form id="supportForm" class="support-form">
        <input id="supportInput" name="supportMessage" class="form-input" type="text" placeholder="Type your question" autocomplete="off" />
        <button class="btn btn-primary" type="submit">Send</button>
      </form>
      <div class="support-footer p-muted">Human support: support@jobportal.com</div>
    </div>
  `;

  document.body.appendChild(widget);

  const toggle = document.getElementById("supportToggle");
  const panel = document.getElementById("supportPanel");
  const closeBtn = document.getElementById("supportClose");
  const form = document.getElementById("supportForm");
  const input = document.getElementById("supportInput");
  const messages = document.getElementById("supportMessages");
  const supportStatus = document.getElementById("supportStatus");
  const supportLiveBtn = document.getElementById("supportLiveBtn");
  const supportUnreadBadge = document.getElementById("supportUnreadBadge");
  const transcript = [];
  let activeTicketId = null;
  let activeTicketStatus = null;
  let ticketPollTimer = null;
  let lastThreadSignature = "";
  let supportSocket = null;
  let hasLoggedUnreadLoadError = false;
  let hasLoggedTicketLoadError = false;
  let isPanelOpen = false;
  let isBootstrapped = false;
  const userRaw = localStorage.getItem("user");
  const token = localStorage.getItem("token");
  let currentUser = null;

  try {
    currentUser = userRaw ? JSON.parse(userRaw) : null;
  } catch (_err) {
    currentUser = null;
  }

  const authHeaders = () => {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const requestWithAuth = (url, options = {}) => {
    if (window.authFetch) {
      return window.authFetch(url, options);
    }
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...authHeaders()
      }
    });
  };

  const bootstrapSupport = async () => {
    if (isBootstrapped) return;
    isBootstrapped = true;
    try {
      await connectRealtime();
    } catch (err) {
      console.error("Failed to connect to realtime:", err);
    }
    loadChatStatus();
    loadUnreadCount();
    appendMessage("Hi! I am the JobPortal AI assistant. Ask me about jobs, applications, payments, or your profile.", false);
    loadExistingTicket();
  };

  const resetTicketState = (messageText = "") => {
    leaveTicketRoom(activeTicketId);
    activeTicketId = null;
    activeTicketStatus = null;
    lastThreadSignature = "";
    stopTicketPolling();
    if (messageText) {
      pushBubble(messageText, false, "system");
    }
    loadUnreadCount();
    loadChatStatus();
  };

  const markTicketClosed = (messageText = "") => {
    activeTicketStatus = "closed";
    stopTicketPolling();
    if (messageText) {
      pushBubble(messageText, false, "system");
    }
    if (supportStatus) {
      supportStatus.textContent = buildTicketStatusText({ status: "closed" });
    }
    loadUnreadCount();
  };

  const setUnreadBadge = (count) => {
    if (!supportUnreadBadge) return;
    const value = Number(count || 0);
    supportUnreadBadge.textContent = String(value > 99 ? "99+" : value);
    supportUnreadBadge.classList.toggle("hidden", value <= 0);
  };

  const loadSocketClient = () =>
    new Promise((resolve, reject) => {
      if (window.io) {
        resolve(window.io);
        return;
      }

      const existing = document.getElementById("socketIoClientScript");
      if (existing) {
        existing.addEventListener("load", () => {
          if (window.io) {
            resolve(window.io);
          } else {
            reject(new Error("Socket.io loaded but window.io not defined"));
          }
        }, { once: true });
        existing.addEventListener("error", () => {
          reject(new Error("Failed to load socket.io client script"));
        }, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.id = "socketIoClientScript";
      script.src = `${API.replace(/\/api$/, "")}/socket.io/socket.io.js`;
      script.onload = () => {
        if (window.io) {
          resolve(window.io);
        } else {
          reject(new Error("Socket.io script loaded but window.io not defined"));
        }
      };
      script.onerror = () => {
        reject(new Error("Failed to load socket.io client from " + script.src));
      };
      document.head.appendChild(script);
    });

  const connectRealtime = async () => {
    if (supportSocket) return;
    try {
      const ioFactory = await loadSocketClient();
      if (!ioFactory) {
        console.warn("Socket.io client not available");
        return;
      }
      
      supportSocket = ioFactory(API.replace(/\/api$/, ""), {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        auth: token ? { token } : {}
      });

      supportSocket.on("connect", () => {
        console.log("âœ… Realtime connection established");
      });

      supportSocket.on("connect_error", (error) => {
        console.warn("âš ï¸ Realtime connection error:", error?.message);
      });

      supportSocket.on("support:new-message", (payload) => {
        if (payload?.ticketId && activeTicketId && payload.ticketId === activeTicketId) {
          loadTicketMessages(true);
        }
        loadUnreadCount();
      });

      supportSocket.on("support:ticket-updated", (payload) => {
        if (payload?.ticketId && activeTicketId && payload.ticketId === activeTicketId) {
          if (String(payload.status || "").toLowerCase() === "closed") {
            markTicketClosed("This support ticket was closed by support. Click Talk to human to start a new one if needed.");
            return;
          }
          loadTicketMessages(true);
        }
        loadUnreadCount();
      });
    } catch (err) {
      console.error(err);
    }
  };

  const joinTicketRoom = () => {
    if (supportSocket && activeTicketId) {
      supportSocket.emit("support:join-ticket", activeTicketId);
    }
  };

  const leaveTicketRoom = (ticketId) => {
    if (supportSocket && ticketId) {
      supportSocket.emit("support:leave-ticket", ticketId);
    }
  };

  const loadUnreadCount = async () => {
    if (!token) {
      setUnreadBadge(0);
      return;
    }
    try {
      const res = await requestWithAuth(`${API}/chat/live-support/unread-count`);
      const data = await res.json();
      if (!res.ok) return;
      setUnreadBadge(data?.unread || 0);
      hasLoggedUnreadLoadError = false;
    } catch (err) {
      if (!hasLoggedUnreadLoadError) {
        console.error("Unable to load unread support count:", err);
        hasLoggedUnreadLoadError = true;
      }
    }
  };

  const pushBubble = (text, isUser, kind = "normal") => {
    const bubble = document.createElement("div");
    bubble.className = isUser ? "support-bubble user" : "support-bubble";
    if (kind === "system") {
      bubble.style.opacity = "0.8";
      bubble.style.fontSize = "12px";
    }
    bubble.textContent = text;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
  };

  const appendMessage = (text, isUser) => {
    pushBubble(text, isUser);
    transcript.push({ role: isUser ? "user" : "assistant", text: String(text || "") });
    if (transcript.length > 30) transcript.shift();
  };

  const stopTicketPolling = () => {
    if (ticketPollTimer) {
      clearInterval(ticketPollTimer);
      ticketPollTimer = null;
    }
  };

  const buildTicketStatusText = (ticket = {}) => {
    if (!activeTicketId) {
      return "Support assistant ready. Ask about jobs, applications, payments, or profile.";
    }

    const parts = [`Human support ticket ${activeTicketId} (${activeTicketStatus || ticket.status || "open"}).`];
    if (ticket.assigned_admin_name) {
      parts.push(`Assigned to ${ticket.assigned_admin_name}.`);
    }
    if (ticket.last_replied_admin_name) {
      parts.push(`Last reply from ${ticket.last_replied_admin_name}.`);
    }
    return parts.join(" ");
  };

  const renderTicketThread = (payload) => {
    const ticket = payload?.ticket || {};
    const rows = Array.isArray(payload?.messages) ? payload.messages : [];
    const signature = rows.map((item) => `${item.id}:${item.created_at}`).join("|");
    if (signature === lastThreadSignature) return;
    lastThreadSignature = signature;

    messages.innerHTML = "";
    rows.forEach((item) => {
      const sender = String(item.sender_type || "").toLowerCase();
      if (sender === "system") {
        pushBubble(item.message, false, "system");
      } else {
        const isUser = sender === "user";
        const supportLabel = item.sender_name || ticket.last_replied_admin_name || "Support";
        pushBubble(isUser ? `You: ${item.message}` : `${supportLabel}: ${item.message}`, isUser);
      }
    });

    activeTicketStatus = ticket?.status || activeTicketStatus;
    if (supportStatus && activeTicketId) {
      supportStatus.textContent = buildTicketStatusText(ticket);
    }
    setUnreadBadge(ticket?.unread_user_count || 0);
  };

  const loadTicketMessages = async (silent = true) => {
    if (!activeTicketId || !token) return;
    if (!isPanelOpen && silent) return;
    try {
      const res = await requestWithAuth(`${API}/chat/live-support/${encodeURIComponent(activeTicketId)}/messages`);
      const data = await res.json();
      if (res.status === 401) {
        resetTicketState("Your session expired. Login again to continue this support ticket.");
        return;
      }
      if (String(data?.ticket?.status || "").toLowerCase() === "closed") {
        markTicketClosed("This support ticket is closed. Click Talk to human to open a new one.");
      }
      if (!res.ok) throw new Error(data?.message || "Failed to load messages");
      renderTicketThread(data);
      hasLoggedTicketLoadError = false;
    } catch (err) {
      if (!hasLoggedTicketLoadError) {
        console.error("Support thread load failed:", err);
        hasLoggedTicketLoadError = true;
      }
      if (!silent && !messages.children.length) {
        appendMessage("Unable to load ticket messages right now. Retrying automatically.", false);
      }
    }
  };

  const startTicketPolling = () => {
    stopTicketPolling();
    ticketPollTimer = setInterval(() => {
      if (!isPanelOpen) return;
      if (document.visibilityState !== "visible") return;
      loadTicketMessages(true);
    }, 8000);
  };

  const loadExistingTicket = async () => {
    if (!token) return;
    try {
      const res = await requestWithAuth(`${API}/chat/live-support/my?limit=10`);
      const tickets = await res.json();
      if (res.status === 401) {
        resetTicketState();
        return;
      }
      if (!res.ok || !Array.isArray(tickets) || !tickets.length) {
        if (activeTicketId) {
          resetTicketState();
        }
        return;
      }

      const active = tickets.find((item) => item.status !== "closed");
      if (!active?.ticket_id) {
        if (activeTicketId || activeTicketStatus === "closed") {
          resetTicketState("Your previous support ticket is closed. Click Talk to human to open a new ticket.");
        }
        return;
      }
      leaveTicketRoom(activeTicketId);
      activeTicketId = active.ticket_id;
      activeTicketStatus = active.status;
      joinTicketRoom();
      if (isPanelOpen) {
        await loadTicketMessages(false);
      }
      startTicketPolling();
    } catch (err) {
      console.error(err);
    }
  };

  const loadChatStatus = async () => {
    try {
      const res = await fetch(`${API}/chat/status`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || "status failed");
      const mode = data?.aiEnabled ? `AI online (${data.provider}: ${data.model})` : "Fallback assistant mode";
      if (supportStatus) supportStatus.textContent = `${mode}. Ask about jobs, applications, payments, or profile.`;
    } catch (err) {
      console.error(err);
      if (supportStatus) supportStatus.textContent = "Support assistant ready. Ask about jobs, applications, payments, or profile.";
    }
  };

  const sendMessage = async (text) => {
    if (!text) return;

    if (activeTicketId && token) {
      appendMessage(text, true);
      try {
        const res = await requestWithAuth(`${API}/chat/live-support/${encodeURIComponent(activeTicketId)}/messages`, {
          method: "POST",
          body: JSON.stringify({ message: text })
        });
        const data = await res.json();
        if (res.status === 401) {
          resetTicketState("Your session expired. Login again to continue this support ticket.");
          return;
        }
        if (!res.ok && String(data?.message || "").toLowerCase().includes("ticket is closed")) {
          markTicketClosed("This support ticket was closed by support. Click Talk to human to open a new ticket.");
          return;
        }
        if (!res.ok) throw new Error(data?.message || "Unable to send message");
        activeTicketStatus = data.status || activeTicketStatus;
        await loadTicketMessages(true);
      } catch (err) {
        console.error(err);
        const fallbackMessage = err?.message === "Failed to fetch"
          ? "Connection to support was lost. Check your network and make sure the backend server is running, then try again."
          : (err.message || "Unable to send to support right now.");
        appendMessage(fallbackMessage, false);
      }
      return;
    }

    appendMessage(text, true);

    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ message: text })
      });
      const data = await res.json();
      appendMessage(data.reply || "Support is unavailable right now.", false);
    } catch (err) {
      console.error(err);
      appendMessage("Support is unavailable right now.", false);
    }
  };

  const requestLiveSupport = async () => {
    if (activeTicketId && activeTicketStatus !== "closed") {
      appendMessage(`You are already connected on ticket ${activeTicketId}. Send your message below.`, false);
      await loadTicketMessages(false);
      return;
    }

    if (activeTicketId && activeTicketStatus === "closed") {
      resetTicketState();
    }

    if (!token || !currentUser) {
      pushBubble("Please login first to continue with human support in chat.", false, "system");
      return;
    }

    const summary = transcript.filter((item) => item.role === "user").slice(-1)[0]?.text || "Need help from human support";
    appendMessage("I need human support", true);

    try {
      const res = await requestWithAuth(`${API}/chat/live-support`, {
        method: "POST",
        body: JSON.stringify({
          message: summary,
          transcript,
          page: window.location.pathname,
          email: currentUser?.email || "",
          name: currentUser?.name || ""
        })
      });
      const data = await res.json();
      if (res.status === 401) {
        pushBubble("Please login again to start a human support chat.", false, "system");
        return;
      }
      if (!res.ok) throw new Error(data?.message || "Live support unavailable");
      appendMessage(data.reply || "Live support request submitted.", false);

      if (data?.ticketId && token) {
        leaveTicketRoom(activeTicketId);
        activeTicketId = data.ticketId;
        activeTicketStatus = "open";
        joinTicketRoom();
        await loadTicketMessages(false);
        startTicketPolling();
        loadUnreadCount();
      }
    } catch (err) {
      console.error(err);
      appendMessage("Unable to create live support ticket right now. Please email support@jobportal.com.", false);
    }
  };

  toggle?.addEventListener("click", () => {
    bootstrapSupport();
    panel.classList.toggle("hidden");
    isPanelOpen = !panel.classList.contains("hidden");
    if (isPanelOpen) {
      loadExistingTicket();
      if (activeTicketId) {
        loadTicketMessages(false);
      }
    }
  });

  closeBtn?.addEventListener("click", () => {
    panel.classList.add("hidden");
    isPanelOpen = false;
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = (input.value || "").trim();
    input.value = "";
    sendMessage(value);
  });

  document.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      sendMessage(button.getAttribute("data-quick"));
    });
  });

  supportLiveBtn?.addEventListener("click", () => {
    requestLiveSupport();
  });

  window.addEventListener("beforeunload", () => {
    stopTicketPolling();
    leaveTicketRoom(activeTicketId);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isPanelOpen && activeTicketId) {
      loadTicketMessages(true);
    }
  });
});
