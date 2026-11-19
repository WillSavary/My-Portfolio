"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const Stripe = require("stripe");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const api = require("./api");

const app = express();
const port = Number(process.env.PORT) || 3000;
const siteRoot = path.resolve(__dirname, "..");
const stripe = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY)
    : null;

app.disable("x-powered-by");
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'", "https://checkout.stripe.com"],
            frameAncestors: ["'none'"],
            imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            scriptSrc: ["'self'"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"]
        }
    }
}));

app.use((request, response, next) => {
    const blockedPath = request.path.split("/").some((part) =>
        part === "node_modules" || part === ".git" || part === ".haulwise-data"
    );
    const privateFile = /(^|\/)(server\.js|api\.js|database\.js|package(?:-lock)?\.json|\.env(?:\..*)?)$/.test(request.path);
    if (blockedPath || privateFile) {
        response.sendStatus(404);
        return;
    }
    next();
});

app.post("/api/billing/webhook", express.raw({ type: "application/json" }), async (request, response) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
        response.status(503).json({ error: "Stripe webhook verification is not configured." });
        return;
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(
            request.body,
            request.get("stripe-signature"),
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (error) {
        console.error("Stripe webhook signature verification failed:", error.message);
        response.status(400).json({ error: "Invalid Stripe webhook signature." });
        return;
    }

    const subscriptionEvents = new Set([
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
        "invoice.paid",
        "invoice.payment_failed"
    ]);

    if (subscriptionEvents.has(event.type)) {
        try {
            const db = require("./database").db;
            let subscription;
            if (event.type === "checkout.session.completed") {
                subscription = await stripe.subscriptions.retrieve(event.data.object.subscription);
            } else if (event.data.object.object === "subscription") {
                subscription = event.data.object;
            } else {
                subscription = null;
            }
            if (subscription) {
                const companyId = subscription.metadata?.companyId
                    || event.data.object.metadata?.companyId
                    || event.data.object.client_reference_id
                    || null;
                if (companyId) {
                    db.prepare(`
                        INSERT INTO subscriptions (
                            id, company_id, stripe_customer_id, stripe_subscription_id, plan, status,
                            current_period_end, cancel_at_period_end, updated_at
                        ) VALUES (?, ?, ?, ?, 'fleet', ?, ?, ?, ?)
                        ON CONFLICT(stripe_subscription_id) DO UPDATE SET
                            company_id=excluded.company_id,
                            stripe_customer_id=excluded.stripe_customer_id,
                            status=excluded.status,
                            current_period_end=excluded.current_period_end,
                            cancel_at_period_end=excluded.cancel_at_period_end,
                            updated_at=excluded.updated_at
                    `).run(
                        crypto.randomUUID(),
                        companyId,
                        typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || "",
                        subscription.id,
                        subscription.status,
                        subscription.current_period_end || null,
                        subscription.cancel_at_period_end ? 1 : 0,
                        new Date().toISOString()
                    );
                }
            }
        } catch (error) {
            console.error("Stripe webhook persistence failed:", error.message);
            response.status(500).json({ error: "Could not persist subscription event." });
            return;
        }
        response.sendStatus(200);
        return;
    }

    response.sendStatus(200);
});

app.use("/api", api);
app.use(express.static(siteRoot, { dotfiles: "deny", index: "index.html" }));

app.listen(port, () => {
    console.log(`Haulwise preview server listening at http://localhost:${port}`);
    console.log("Stripe checkout stays disabled until billing and subscription provisioning are implemented.");
    console.log("Configure ADMIN_BOOTSTRAP_TOKEN privately to enable one-time owner setup.");
});

function requireSameOrigin(request, response, next) {
    let expectedOrigin;
    try {
        expectedOrigin = new URL(process.env.APP_BASE_URL).origin;
    } catch {
        response.status(503).json({ error: "The public site URL is not configured." });
        return;
    }

    if (request.get("origin") !== expectedOrigin) {
        response.status(403).json({ error: "Checkout request origin is not allowed." });
        return;
    }
    next();
}
