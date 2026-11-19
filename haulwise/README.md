# Haulwise web app

Haulwise includes a driver workspace, account sign-in, a protected owner console, and a local SQLite data store. Customer sign-ups remain pending until the owner approves the account and company. The payment flow is still disabled.

## Run locally

Install Node.js 20 or newer. From this directory:

```text
npm install
npm start
```

Open `http://localhost:3000/haulwise/`. The Express server also serves the portfolio pages from the repository root. Set `APP_BASE_URL` to the exact origin used in the browser; state-changing API requests are restricted to that origin.

## First owner setup

1. Copy `.env.example` to `.env`. Never commit `.env`.
2. Generate a random token with Node:

   ```text
   node -p "require('node:crypto').randomBytes(48).toString('base64url')"
   ```

3. Set the generated value as `ADMIN_BOOTSTRAP_TOKEN`. Do not send it to the browser except by entering it directly on the one-time setup page.
4. Start the server and open `/haulwise/admin-setup.html` from the configured site origin. The owner chooses the admin username, email, and password. Passwords are stored as salted scrypt hashes; no default admin credentials exist.
5. After setup, remove `ADMIN_BOOTSTRAP_TOKEN` from `.env`. The owner console is at `/haulwise/admin.html`; it is not linked from public pages, but its APIs still require an authenticated owner session.
6. Approve pending company and user requests in the owner console. Create carrier workspaces there; the invitation code is displayed once and should be shared privately with drivers.

Owner sessions use an HTTP-only, SameSite=Strict cookie, expire after eight hours, and are protected by rate limits and same-origin checks. Use HTTPS for any non-local deployment. The owner console intentionally excludes passwords, setup tokens, payment credentials, GPS traces, and page contents. Its audit log records account and operational record changes only.

SQLite is a single-server setup. The database is stored in the ignored `.haulwise-data` directory by default. `HAULWISE_DATA_DIR` may point outside the public site root. Back up the database securely and restrict host access before using real customer data. For multiple app instances, use a managed database and a reviewed production deployment.

## Accounts and data sync

Account requests are stored on the server and start in a pending state. The owner must approve the user and, where applicable, the company. Email ownership verification and automated email delivery are not configured.

Trips, truck details, and saved facilities continue to work locally in the browser. After sign-in, use **Import this browser's trips and facilities** to explicitly upload local records to the account. The sample trip and current GPS coordinates are excluded. Once signed in, new trip, truck, and facility changes sync to that account. The owner can review all server-backed company records; browser data from other devices is not discoverable until that user signs in and imports it.

The current data model covers users, companies, trucks, trips/shipments, saved facilities, and limited audit events. It does not record every click, page view, or arbitrary website activity.

## Live GPS and route handoff

The driver can explicitly start foreground GPS tracking on the trip page. Position updates stay in the current page, can be opened as a point in OpenStreetMap, and stop when the driver leaves the trip view, hides the page, or presses Stop. GPS coordinates are not written to the account database. Typed pickup and exact gate/dock addresses remain available as a fallback.

Haulwise shares or copies start and destination details for the driver's chosen navigation app. It does not calculate routes, provide turn-by-turn guidance, geocode addresses, verify truck restrictions, or guarantee dock access. Use a truck-navigation provider for truck-legal route guidance and confirm entrances with dispatch or the receiver.

## Stripe status

The server-side checkout and webhook routes intentionally fail closed. They do not create a payment or subscription. Real checkout remains disabled until authentication-linked customer records, durable subscription entitlements, verified webhook persistence, a configured Stripe Price ID, and a public HTTPS deployment have been reviewed and tested.

Never put Stripe API or webhook secrets in browser code or commit them. Configure payout accounts privately in Stripe's dashboard. The proposed price shown on the plans page is not a live offer.
