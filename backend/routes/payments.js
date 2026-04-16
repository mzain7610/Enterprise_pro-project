const express = require("express");
const router = express.Router();
const Stripe = require("stripe");
const { auth } = require("../middleware/auth");
const adminAuth = require("../middleware/adminAuth");
const db = require("../config/mysql");
const validate = require("../middleware/validate");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const PREMIUM_PRICE_CENTS = Number(process.env.PREMIUM_PRICE_CENTS || 1000);
const PREMIUM_CURRENCY = process.env.PREMIUM_CURRENCY || "usd";
const USE_MOCK_PAYMENTS = process.env.USE_MOCK_PAYMENTS === "true" || !STRIPE_SECRET_KEY;
const MAX_DONATION_CENTS = 5000;
const { notifyShiftAlerts } = require("../utils/shiftAlerts");

const ALLOWED_PAYMENT_METHODS = ["card", "applepay", "gpay", "paypal", "bank_transfer"];

const normalizePaymentMethod = (value) => {
  const method = String(value || "card").trim().toLowerCase();
  if (!ALLOWED_PAYMENT_METHODS.includes(method)) return null;
  return method;
};

const getStripePaymentMethodTypes = (selectedMethod) => {
  // In Stripe Checkout, Apple Pay and Google Pay are wallet flows on top of card.
  if (selectedMethod === "applepay" || selectedMethod === "gpay") {
    return ["card"];
  }

  // PayPal availability depends on Stripe account/country capabilities.
  if (selectedMethod === "paypal") {
    return ["paypal"];
  }

  // Generic bank transfer option maps to US bank account in Stripe Checkout.
  if (selectedMethod === "bank_transfer") {
    return ["us_bank_account"];
  }

  return ["card"];
};

const getUserRoleFlags = (userId) =>
  new Promise((resolve, reject) => {
    db.query(
      "SELECT role, is_admin FROM users WHERE id = ? LIMIT 1",
      [userId],
      (err, rows) => {
        if (err) return reject(err);
        if (!rows || !rows.length) return resolve(null);
        resolve({ role: rows[0].role, is_admin: Number(rows[0].is_admin) === 1 });
      }
    );
  });

if (!STRIPE_SECRET_KEY) {
  console.warn("⚠️ STRIPE_SECRET_KEY is not set. Using mock payments.");
}

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

router.post(
  "/create-checkout-session",
  auth,
  validate({
    body: {
      mode: { required: true, type: "string", enum: ["create", "upgrade", "reboost"] },
      payment_method: { required: true, type: "string", enum: ALLOWED_PAYMENT_METHODS },
      donation_cents: { type: "number", coerce: true, min: 0, max: MAX_DONATION_CENTS },
      jobId: { type: "number", coerce: true, min: 1 }
    }
  }),
  async (req, res) => {

  const { mode, jobId, donation_cents, payment_method } = req.body;

  if (!mode || !["create", "upgrade", "reboost"].includes(mode)) {
    return res.status(400).json({ message: "Invalid payment mode" });
  }

  if ((mode === "upgrade" || mode === "reboost") && !jobId) {
    return res.status(400).json({ message: "jobId is required" });
  }

  const donationCents = Number(donation_cents || 0);
  if (!Number.isFinite(donationCents) || donationCents < 0 || donationCents > MAX_DONATION_CENTS) {
    return res.status(400).json({ message: "Invalid donation amount" });
  }

  const selectedPaymentMethod = normalizePaymentMethod(payment_method);
  if (!selectedPaymentMethod) {
    return res.status(400).json({ message: "Invalid payment method" });
  }

  try {
    const successUrl = mode === "upgrade"
      ? `${FRONTEND_URL}/admin.html?payment=success&mode=upgrade&jobId=${jobId}&session_id={CHECKOUT_SESSION_ID}`
      : mode === "reboost"
      ? `${FRONTEND_URL}/employer.html?payment=success&mode=reboost&jobId=${jobId}&session_id={CHECKOUT_SESSION_ID}`
      : `${FRONTEND_URL}/post-jobs.html?payment=success&mode=create&session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl = mode === "upgrade"
      ? `${FRONTEND_URL}/admin.html?payment=cancel`
      : mode === "reboost"
      ? `${FRONTEND_URL}/employer.html?payment=cancel`
      : `${FRONTEND_URL}/post-jobs.html?payment=cancel`;

    if (USE_MOCK_PAYMENTS) {
      const mockSessionId = `mock_${Date.now()}`;
      const mockUrl = successUrl.replace("{CHECKOUT_SESSION_ID}", mockSessionId);
      return res.json({
        url: mockUrl,
        mock: true,
        payment_method: selectedPaymentMethod,
        message: `Mock checkout created with ${selectedPaymentMethod}`
      });
    }

    const lineItems = [
      {
        quantity: 1,
        price_data: {
          currency: PREMIUM_CURRENCY,
          unit_amount: PREMIUM_PRICE_CENTS,
          product_data: {
            name: "Premium Job Posting",
            description: "Boost your job visibility"
          }
        }
      }
    ];

    if (donationCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: PREMIUM_CURRENCY,
          unit_amount: donationCents,
          product_data: {
            name: "Support Tip",
            description: "Optional donation"
          }
        }
      });
    }

    const paymentMethodTypes = getStripePaymentMethodTypes(selectedPaymentMethod);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: paymentMethodTypes,
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        mode,
        jobId: jobId ? String(jobId) : "",
        user_id: String(req.user.id),
        selected_payment_method: selectedPaymentMethod
      }
    });

    res.json({ url: session.url, payment_method: selectedPaymentMethod });
  } catch (err) {
    // If Stripe method is not enabled in account, gracefully fall back to card.
    if (!USE_MOCK_PAYMENTS && String(err && err.message || "").toLowerCase().includes("payment method")) {
      try {
        const fallbackLineItems = [
          {
            quantity: 1,
            price_data: {
              currency: PREMIUM_CURRENCY,
              unit_amount: PREMIUM_PRICE_CENTS,
              product_data: {
                name: "Premium Job Posting",
                description: "Boost your job visibility"
              }
            }
          }
        ];

        if (donationCents > 0) {
          fallbackLineItems.push({
            quantity: 1,
            price_data: {
              currency: PREMIUM_CURRENCY,
              unit_amount: donationCents,
              product_data: {
                name: "Support Tip",
                description: "Optional donation"
              }
            }
          });
        }

        const fallbackSession = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          line_items: fallbackLineItems,
          success_url: mode === "upgrade"
            ? `${FRONTEND_URL}/admin.html?payment=success&mode=upgrade&jobId=${jobId}&session_id={CHECKOUT_SESSION_ID}`
            : mode === "reboost"
            ? `${FRONTEND_URL}/employer.html?payment=success&mode=reboost&jobId=${jobId}&session_id={CHECKOUT_SESSION_ID}`
            : `${FRONTEND_URL}/post-jobs.html?payment=success&mode=create&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: mode === "upgrade"
            ? `${FRONTEND_URL}/admin.html?payment=cancel`
            : mode === "reboost"
            ? `${FRONTEND_URL}/employer.html?payment=cancel`
            : `${FRONTEND_URL}/post-jobs.html?payment=cancel`,
          metadata: {
            mode,
            jobId: jobId ? String(jobId) : "",
            user_id: String(req.user.id),
            selected_payment_method: "card"
          }
        });

        return res.json({
          url: fallbackSession.url,
          payment_method: "card",
          warning: `Selected payment method is not enabled in Stripe. Falling back to card.`
        });
      } catch (fallbackErr) {
        console.error(fallbackErr);
      }
    }

    console.error(err);
    res.status(500).json({ message: "Failed to create checkout session" });
  }
  }
);

router.post(
  "/confirm",
  auth,
  validate({
    body: {
      sessionId: { required: true, type: "string", minLength: 3, maxLength: 255 },
      mode: { required: true, type: "string", enum: ["create", "upgrade", "reboost", "donation"] },
      jobId: { type: "number", coerce: true, min: 1 }
    }
  }),
  async (req, res) => {
  const { sessionId, mode, jobId, jobData } = req.body;

  if (!sessionId || !mode) {
    return res.status(400).json({ message: "Missing sessionId or mode" });
  }

  try {
    if (!USE_MOCK_PAYMENTS) {
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.status(400).json({ message: "Payment not completed" });
      }

      const metadata = session.metadata || {};
      if (String(metadata.user_id || "") !== String(req.user.id)) {
        return res.status(403).json({ message: "Session does not belong to current user" });
      }
      if (String(metadata.mode || "") !== String(mode)) {
        return res.status(400).json({ message: "Session mode mismatch" });
      }
      if ((mode === "upgrade" || mode === "reboost") && String(metadata.jobId || "") !== String(jobId || "")) {
        return res.status(400).json({ message: "Session job mismatch" });
      }
    }

    if (mode === "donation") {
      return res.json({ message: "Donation received" });
    }

    if (mode === "upgrade") {
      if (!jobId) return res.status(400).json({ message: "jobId is required" });

      return adminAuth(req, res, () => {
        db.query(
          "UPDATE jobs SET is_premium = 1 WHERE id = ?",
          [jobId],
          (err, result) => {
            if (err) return res.status(500).json({ message: "Failed to upgrade job" });
            if (result.affectedRows === 0) return res.status(404).json({ message: "Job not found" });
            res.json({ message: "Job upgraded to premium" });
          }
        );
      });
    }

    if (mode === "reboost") {
      if (!jobId) return res.status(400).json({ message: "jobId is required" });

      return db.query(
        "SELECT posted_by FROM jobs WHERE id = ? LIMIT 1",
        [jobId],
        (jobErr, jobRows) => {
          if (jobErr) return res.status(500).json({ message: "Failed to validate job" });
          if (!jobRows.length) return res.status(404).json({ message: "Job not found" });

          const postedBy = Number(jobRows[0].posted_by);
          const isAdmin = Number(req.user.is_admin) === 1;
          if (!isAdmin && postedBy !== Number(req.user.id)) {
            return res.status(403).json({ message: "Not authorized to reboost this job" });
          }

          db.query(
            "UPDATE jobs SET is_premium = 1, reboost_count = reboost_count + 1 WHERE id = ?",
            [jobId],
            (updateErr, result) => {
              if (updateErr) return res.status(500).json({ message: "Failed to reboost job" });
              if (result.affectedRows === 0) return res.status(404).json({ message: "Job not found" });
              res.json({ message: "Job reboosted successfully" });
            }
          );
        }
      );
    }

    if (mode === "create") {
      if (!jobData) return res.status(400).json({ message: "jobData is required" });

      const roleInfo = await getUserRoleFlags(req.user.id);
      if (!roleInfo) return res.status(404).json({ message: "User not found" });
      if (!(roleInfo.is_admin || roleInfo.role === "employer")) {
        return res.status(403).json({ message: "Employer access only" });
      }

      const { title, location, job_type, category, description } = jobData;
      const userId = req.user.id;

      if (!title || !location || !job_type || !category || !description) {
        return res.status(400).json({ message: "All fields are required" });
      }

      db.query("SELECT verified FROM users WHERE id = ?", [userId], (err, users) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (!users.length) return res.status(404).json({ message: "User not found" });
        if (!users[0].verified) return res.status(403).json({ message: "User not verified" });

        db.query(
          `INSERT INTO jobs
             (title, location, job_type, category, description,
              is_premium, is_approved, posted_by, company_id,
              is_shift, shift_start, shift_end, shift_pay_cents,
              shift_fee_cents, shift_total_cents, shift_currency,
              shift_paid, shift_status, application_deadline,
              moderation_status, moderation_score, moderation_reason, auto_approved_at)
           VALUES (?, ?, ?, ?, ?, 1, 1, ?, NULL,
                   0, NULL, NULL, NULL,
                   NULL, NULL, 'usd',
                   0, 'open', NULL,
                   NULL, NULL, NULL, NULL)`,
          [title, location, job_type, category, description, userId],
          (err, result) => {
            if (err) return res.status(500).json({ message: "Failed to create premium job" });
            res.json({ message: "Premium job created", id: result.insertId });
          }
        );
      });

      return;
    }

    return res.status(400).json({ message: "Invalid payment mode" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to confirm payment" });
  }
  }
);

router.post(
  "/confirm-shift",
  auth,
  validate({
    body: {
      jobId: { required: true, type: "number", coerce: true, min: 1 }
    }
  }),
  (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ message: "jobId is required" });

  db.query(
    "SELECT role, is_admin FROM users WHERE id = ? LIMIT 1",
    [req.user.id],
    (userErr, userRows) => {
      if (userErr) return res.status(500).json({ message: "Failed to check permissions" });
      if (!userRows.length) return res.status(404).json({ message: "User not found" });

      const user = userRows[0];
      const isAdmin = Number(user.is_admin) === 1;

      db.query(
        "SELECT id, posted_by FROM jobs WHERE id = ? LIMIT 1",
        [jobId],
        (jobErr, jobRows) => {
          if (jobErr) return res.status(500).json({ message: "Failed to fetch job" });
          if (!jobRows.length) return res.status(404).json({ message: "Job not found" });

          if (!isAdmin && Number(jobRows[0].posted_by) !== Number(req.user.id)) {
            return res.status(403).json({ message: "Not authorized to confirm this shift payment" });
          }

          db.query(
            "UPDATE jobs SET shift_paid = 1 WHERE id = ?",
            [jobId],
            (err, result) => {
              if (err) return res.status(500).json({ message: "Failed to update shift payment" });
              if (result.affectedRows === 0) return res.status(404).json({ message: "Job not found" });

              notifyShiftAlerts(jobId, { status: "paid", paidAt: new Date() });
              res.json({ message: "Shift payment confirmed" });
            }
          );
        }
      );
    }
  );
  }
);

router.post(
  "/create-donation-session",
  auth,
  validate({
    body: {
      context: { required: true, type: "string", enum: ["apply", "post"] },
      amount_cents: { required: true, type: "number", coerce: true, min: 1, max: MAX_DONATION_CENTS },
      payment_method: { required: true, type: "string", enum: ALLOWED_PAYMENT_METHODS }
    }
  }),
  async (req, res) => {
  const { context, amount_cents, payment_method } = req.body;
  const donationCents = Number(amount_cents || 0);

  if (!context || !["apply", "post"].includes(context)) {
    return res.status(400).json({ message: "Invalid donation context" });
  }

  if (!Number.isFinite(donationCents) || donationCents <= 0 || donationCents > MAX_DONATION_CENTS) {
    return res.status(400).json({ message: "Invalid donation amount" });
  }

  const selectedPaymentMethod = normalizePaymentMethod(payment_method);
  if (!selectedPaymentMethod) {
    return res.status(400).json({ message: "Invalid payment method" });
  }

  try {
    const successUrl = `${FRONTEND_URL}/${context === "apply" ? "apply.html" : "post-jobs.html"}?donation=success&context=${context}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${FRONTEND_URL}/${context === "apply" ? "apply.html" : "post-jobs.html"}?donation=cancel&context=${context}`;

    if (USE_MOCK_PAYMENTS) {
      const mockSessionId = `mock_${Date.now()}`;
      const mockUrl = successUrl.replace("{CHECKOUT_SESSION_ID}", mockSessionId);
      return res.json({
        url: mockUrl,
        mock: true,
        payment_method: selectedPaymentMethod,
        message: `Mock donation checkout created with ${selectedPaymentMethod}`
      });
    }

    const paymentMethodTypes = getStripePaymentMethodTypes(selectedPaymentMethod);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: paymentMethodTypes,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: PREMIUM_CURRENCY,
            unit_amount: donationCents,
            product_data: {
              name: "Support Tip",
              description: "Optional donation"
            }
          }
        }
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        mode: "donation",
        context,
        user_id: String(req.user.id),
        selected_payment_method: selectedPaymentMethod
      }
    });

    res.json({ url: session.url, payment_method: selectedPaymentMethod });
  } catch (err) {
    if (!USE_MOCK_PAYMENTS && String(err && err.message || "").toLowerCase().includes("payment method")) {
      try {
        const fallbackSession = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: PREMIUM_CURRENCY,
                unit_amount: donationCents,
                product_data: {
                  name: "Support Tip",
                  description: "Optional donation"
                }
              }
            }
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            mode: "donation",
            context,
            user_id: String(req.user.id),
            selected_payment_method: "card"
          }
        });

        return res.json({
          url: fallbackSession.url,
          payment_method: "card",
          warning: `Selected payment method is not enabled in Stripe. Falling back to card.`
        });
      } catch (fallbackErr) {
        console.error(fallbackErr);
      }
    }

    console.error(err);
    res.status(500).json({ message: "Failed to create donation session" });
  }
  }
);

module.exports = router;
