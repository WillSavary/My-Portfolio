"use strict";

const path = require("node:path");
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

app.post(
    "/api/billing/checkout",
    rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false }),
    express.json({ limit: "1kb" }),
    requireSameOrigin,
    requireAuthenticatedCustomer,
    requireSubscriptionProvisioning,
    async (request, response) => {
        if (!stripe || !process.env.STRIPE_FLEET_PRICE_ID || !process.env.APP_BASE_URL) {
            response.status(503).json({ error: "Stripe server configuration is incomplete." });
            return;
        }
        if (request.body.plan !== "fleet") {
            response.status(400).json({ error: "Choose an available plan." });
            return;
        }

        try {
            const baseUrl = new URL(process.env.APP_BASE_URL).origin;
            const session = await stripe.checkout.sessions.create({
                mode: "subscription",
                line_items: [{ price: process.env.STRIPE_FLEET_PRICE_ID, quantity: 1 }],
                client_reference_id: String(request.user.id),
                customer_email: request.user.email,
                metadata: { userId: String(request.user.id) },
                subscription_data: { metadata: { userId: String(request.user.id) } },
                success_url: `${baseUrl}/haulwise/checkout.html?checkout=complete`,
                cancel_url: `${baseUrl}/haulwise/checkout.html?plan=fleet&checkout=cancelled`
            });
            response.json({ url: session.url });
        } catch (error) {
            console.error("Stripe Checkout session creation failed:", error.message);
            response.status(502).json({ error: "Could not create secure checkout. No payment was made." });
        }
    }
);

app.post("/api/billing/webhook", express.raw({ type: "application/json" }), (request, response) => {
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
        response.status(503).json({
            error: "Subscription persistence is not configured; billing must remain disabled."
        });
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

function requireAuthenticatedCustomer(request, response, next) {
    if (!request.user || !request.user.id || !request.user.email) {
        response.status(503).json({ error: "Secure sign-in is not connected; checkout is disabled." });
        return;
    }
    next();
}

function requireSubscriptionProvisioning(request, response, next) {
    response.status(503).json({
        error: "Subscription activation is not connected; checkout is disabled until verified billing events can be stored."
    });
}
