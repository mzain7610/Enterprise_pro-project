const express = require("express");
const Stripe = require("stripe");
const db = require("../config/mysql");

const router = express.Router();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

const ensureWebhookEventTable = () =>
  new Promise((resolve, reject) => {
    db.query(
      `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id VARCHAR(255) NOT NULL UNIQUE,
        event_type VARCHAR(120) NOT NULL,
        session_id VARCHAR(255) NULL,
        mode VARCHAR(50) NULL,
        processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => (err ? reject(err) : resolve())
    );
  });

const markEventProcessed = ({ eventId, eventType, sessionId, mode }) =>
  new Promise((resolve, reject) => {
    db.query(
      `INSERT INTO stripe_webhook_events (event_id, event_type, session_id, mode)
       VALUES (?, ?, ?, ?)`,
      [eventId, eventType, sessionId || null, mode || null],
      (err, result) => {
        if (err) {
          if (err.code === "ER_DUP_ENTRY") return resolve(false);
          return reject(err);
        }
        resolve(Boolean(result && result.affectedRows > 0));
      }
    );
  });

const applyCheckoutSessionEffects = (session) =>
  new Promise((resolve, reject) => {
    const metadata = session && session.metadata ? session.metadata : {};
    const mode = String(metadata.mode || "").toLowerCase();
    const jobId = Number(metadata.jobId || 0);

    // Donation currently has no DB side-effects.
    if (mode === "donation") return resolve();

    // For upgrade or reboost, mark job premium as soon as Stripe confirms payment.
    if ((mode === "upgrade" || mode === "reboost") && Number.isInteger(jobId) && jobId > 0) {
      const sql = mode === "reboost"
        ? "UPDATE jobs SET is_premium = 1, reboost_count = reboost_count + 1 WHERE id = ?"
        : "UPDATE jobs SET is_premium = 1 WHERE id = ?";
      db.query(sql, [jobId], (err) => {
        if (err) return reject(err);
        return resolve();
      });
      return;
    }

    // For create mode, job creation still happens in /confirm because it requires jobData payload.
    return resolve();
  });

router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ message: "Stripe webhook is not configured" });
  }

  const signature = req.headers["stripe-signature"];
  if (!signature) {
    return res.status(400).json({ message: "Missing stripe-signature header" });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ message: `Webhook signature error: ${err.message}` });
  }

  try {
    await ensureWebhookEventTable();

    const sessionObj = event && event.data && event.data.object ? event.data.object : null;
    const sessionId = sessionObj && sessionObj.id ? String(sessionObj.id) : null;
    const mode = sessionObj && sessionObj.metadata ? String(sessionObj.metadata.mode || "") : null;

    const firstTime = await markEventProcessed({
      eventId: String(event.id || ""),
      eventType: String(event.type || "unknown"),
      sessionId,
      mode
    });

    if (!firstTime) {
      return res.json({ received: true, duplicate: true });
    }

    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      await applyCheckoutSessionEffects(sessionObj);
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("[paymentsWebhook]", err);
    return res.status(500).json({ message: "Failed to process webhook event" });
  }
});

module.exports = router;
