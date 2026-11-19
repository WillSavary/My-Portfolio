"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getFreePort() {
    const listener = net.createServer();
    await new Promise((resolve, reject) => {
        listener.once("error", reject);
        listener.listen(0, "127.0.0.1", resolve);
    });
    const { port } = listener.address();
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    return port;
}

(async () => {
    const port = await getFreePort();
    const origin = `http://localhost:${port}`;
    const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "haulwise-integration-"));
    const serverPath = path.resolve(__dirname, "..", "server.js");
    const serverOptions = {
        cwd: path.resolve(__dirname, ".."),
        env: {
            ...process.env,
            PORT: String(port),
            APP_BASE_URL: origin,
            ADMIN_BOOTSTRAP_TOKEN: "integration-test-token-that-is-long-enough",
            HAULWISE_DATA_DIR: dataDirectory,
            STRIPE_SECRET_KEY: "",
            STRIPE_FLEET_PRICE_ID: "",
            STRIPE_WEBHOOK_SECRET: ""
        },
        stdio: ["ignore", "ignore", "pipe"]
    };
    let server;
    let serverErrors = "";

    function startServer() {
        server = spawn(process.execPath, [serverPath], serverOptions);
        server.stderr.setEncoding("utf8");
        server.stderr.on("data", (chunk) => { serverErrors += chunk; });
    }

    async function stopServer() {
        if (!server || server.exitCode !== null) return;
        const stopped = new Promise((resolve) => server.once("exit", resolve));
        server.kill("SIGTERM");
        await stopped;
    }

    async function request(urlPath, { method = "GET", body, cookie } = {}) {
        const headers = {};
        if (method !== "GET" && method !== "HEAD") headers.Origin = origin;
        if (body !== undefined) {
            headers["Content-Type"] = "application/json";
        }
        if (cookie) headers.Cookie = cookie;
        const response = await fetch(`${origin}${urlPath}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = response.status === 204 ? "" : await response.text();
        let result = {};
        if (text) {
            try {
                result = JSON.parse(text);
            } catch {
                result = text;
            }
        }
        return {
            status: response.status,
            body: result,
            cookie: response.headers.get("set-cookie")?.split(";")[0] || ""
        };
    }

    async function waitForServer() {
        for (let attempt = 0; attempt < 50; attempt += 1) {
            if (server.exitCode !== null) {
                throw new Error(`Test server exited unexpectedly. ${serverErrors}`);
            }
            try {
                const response = await request("/api/admin/setup-status");
                if (response.status === 200) return;
            } catch {
                await wait(100);
            }
        }
        throw new Error(`Test server did not start. ${serverErrors}`);
    }

    try {
        startServer();
        await waitForServer();

        const setup = await request("/api/admin/setup-status");
        assert.equal(setup.body.configured, false);
        assert.equal(setup.body.setupEnabled, true);

        const accountPage = await request("/haulwise/account.html");
        assert.equal(accountPage.status, 200);
        const privatePage = await request("/haulwise/api.js");
        assert.equal(privatePage.status, 404);

        const ownerSetup = await request("/api/admin/bootstrap", {
            method: "POST",
            body: {
                setupToken: "integration-test-token-that-is-long-enough",
                username: "test-owner",
                email: "owner@example.test",
                password: "owner-password-for-integration"
            }
        });
        assert.equal(ownerSetup.status, 201);
        assert.ok(ownerSetup.cookie);
        assert.equal(Object.hasOwn(ownerSetup.body.user, "password_hash"), false);
        const ownerCookie = ownerSetup.cookie;

        const registrationBody = {
            accountType: "company",
            companyName: "Example Hauling",
            businessEmail: "dispatch@example.test",
            businessKind: "For-hire motor carrier",
            dotNumber: "1234567",
            name: "Test Driver",
            email: "driver@example.test",
            password: "driver-password-for-integration"
        };
        const registration = await request("/api/auth/register", {
            method: "POST",
            body: registrationBody
        });
        assert.equal(registration.status, 202);
        assert.match(registration.body.message, /pending owner approval/i);

        const pendingLogin = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: registrationBody.email, password: registrationBody.password }
        });
        assert.equal(pendingLogin.status, 403);

        const independentAccount = {
            accountType: "owner",
            name: "Test Owner-Operator",
            email: "independent@example.test",
            password: "independent-password-for-integration"
        };
        const independentRegistration = await request("/api/auth/register", {
            method: "POST",
            body: independentAccount
        });
        assert.equal(independentRegistration.status, 202);

        const carrier = await request("/api/admin/companies", {
            method: "POST",
            body: { name: "Invitation Test Carrier" },
            cookie: ownerCookie
        });
        assert.equal(carrier.status, 201);
        assert.ok(carrier.body.inviteCode);
        const driverAccount = {
            accountType: "driver",
            inviteCode: carrier.body.inviteCode,
            name: "Invited Test Driver",
            email: "invited-driver@example.test",
            password: "invited-driver-password-for-integration"
        };
        const driverRegistration = await request("/api/auth/register", {
            method: "POST",
            body: driverAccount
        });
        assert.equal(driverRegistration.status, 202);

        const users = await request("/api/admin/records/users", { cookie: ownerCookie });
        const newUser = users.body.records.find((user) => user.email === registrationBody.email);
        const independentUser = users.body.records.find((user) => user.email === independentAccount.email);
        const driverUser = users.body.records.find((user) => user.email === driverAccount.email);
        assert.ok(newUser);
        assert.ok(independentUser);
        assert.ok(driverUser);
        assert.equal(newUser.status, "pending");
        assert.equal(independentUser.status, "pending");
        assert.equal(driverUser.status, "pending");

        const companies = await request("/api/admin/records/companies", { cookie: ownerCookie });
        const newCompany = companies.body.records.find((company) => company.name === registrationBody.companyName);
        const independentCompany = companies.body.records.find((company) => company.name === `${independentAccount.name} - Independent`);
        assert.ok(newCompany);
        assert.ok(independentCompany);
        assert.equal(newCompany.status, "pending");
        assert.equal(independentCompany.status, "pending");

        for (const company of [newCompany, independentCompany]) {
            const approval = await request(`/api/admin/companies/${company.id}/status`, {
                method: "PATCH",
                body: { status: "active" },
                cookie: ownerCookie
            });
            assert.equal(approval.status, 200);
        }
        for (const user of [newUser, independentUser, driverUser]) {
            const approval = await request(`/api/admin/users/${user.id}/status`, {
                method: "PATCH",
                body: { status: "active" },
                cookie: ownerCookie
            });
            assert.equal(approval.status, 200);
        }

        const duplicateRegistration = await request("/api/auth/register", {
            method: "POST",
            body: registrationBody
        });
        assert.equal(duplicateRegistration.status, 409);

        const login = await request("/api/auth/login", {
            method: "POST",
            body: { identifier: registrationBody.email, password: registrationBody.password }
        });
        assert.equal(login.status, 200);
        assert.ok(login.cookie);
        assert.equal(login.body.user.email, registrationBody.email);
        assert.equal(Object.hasOwn(login.body.user, "password_hash"), false);
        const userCookie = login.cookie;

        const otherAccountCookies = [];
        for (const account of [independentAccount, driverAccount]) {
            const accountLogin = await request("/api/auth/login", {
                method: "POST",
                body: { identifier: account.email, password: account.password }
            });
            assert.equal(accountLogin.status, 200);
            assert.equal(accountLogin.body.user.email, account.email);
            assert.ok(accountLogin.cookie);
            otherAccountCookies.push(accountLogin.cookie);
        }

        const authStatus = await request("/api/auth/status", { cookie: userCookie });
        assert.equal(authStatus.body.authenticated, true);
        assert.equal(authStatus.body.user.name, registrationBody.name);

        const accountData = {
            truck: { name: "Freightliner Cascadia", unit: "104", plate: "ABC123" },
            trips: [{
                id: "integration-trip",
                company: "Example Customer",
                reference: "LOAD-42",
                origin: "Columbus, OH",
                originAddress: "1 Origin Road",
                destination: "Cleveland, OH",
                address: "2 Destination Road",
                entry: "Use north gate",
                start: 100,
                end: 250,
                date: "2026-01-15T12:00:00.000Z"
            }],
            facilities: [{
                id: "integration-facility",
                name: "Example Distribution Center",
                country: "US",
                address: "2 Destination Road",
                notes: "North gate",
                verifiedAt: "2026-01-15T12:00:00.000Z"
            }]
        };
        const saveData = await request("/api/account/data", {
            method: "PUT",
            body: { data: accountData },
            cookie: userCookie
        });
        assert.equal(saveData.status, 200);

        const storedData = await request("/api/account/data", { cookie: userCookie });
        assert.equal(storedData.status, 200);
        assert.equal(storedData.body.data.truck.unit, "104");
        assert.equal(storedData.body.data.trips[0].reference, "LOAD-42");
        assert.equal(storedData.body.data.facilities[0].name, "Example Distribution Center");
        for (const cookie of otherAccountCookies) {
            const isolatedData = await request("/api/account/data", { cookie });
            assert.equal(isolatedData.status, 200);
            assert.equal(isolatedData.body.data.trips.length, 0);
            assert.equal(isolatedData.body.data.facilities.length, 0);
        }

        const databaseFile = path.join(dataDirectory, "haulwise.sqlite");
        assert.equal(fs.existsSync(databaseFile), true);

        await stopServer();
        startServer();
        await waitForServer();
        const persistedData = await request("/api/account/data", { cookie: userCookie });
        assert.equal(persistedData.status, 200);
        assert.equal(persistedData.body.data.trips[0].reference, "LOAD-42");

        const logout = await request("/api/auth/logout", {
            method: "POST",
            cookie: userCookie
        });
        assert.equal(logout.status, 204);
        const protectedData = await request("/api/account/data", { cookie: userCookie });
        assert.equal(protectedData.status, 401);

        console.log("Account registration, approval, sign-in, and SQLite persistence checks passed.");
    } finally {
        await stopServer();
        fs.rmSync(dataDirectory, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
