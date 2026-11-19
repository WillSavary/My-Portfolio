"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { createTripCsv } = require("../trip-export");

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
    const server = spawn(process.execPath, [path.resolve(__dirname, "..", "server.js")], {
        cwd: path.resolve(__dirname, ".."),
        env: { ...process.env, PORT: String(port) },
        stdio: ["ignore", "ignore", "pipe"]
    });
    let serverErrors = "";
    server.stderr.setEncoding("utf8");
    server.stderr.on("data", (chunk) => { serverErrors += chunk; });

    async function request(urlPath) {
        const response = await fetch(`${origin}${urlPath}`);
        return { status: response.status, body: await response.text() };
    }

    async function waitForServer() {
        for (let attempt = 0; attempt < 50; attempt += 1) {
            if (server.exitCode !== null) throw new Error(`Test server exited unexpectedly. ${serverErrors}`);
            try {
                const response = await request("/haulwise/");
                if (response.status === 200) return;
            } catch {
                await wait(100);
            }
        }
        throw new Error(`Test server did not start. ${serverErrors}`);
    }

    try {
        await waitForServer();

        const navigationPages = [
            "/",
            "/work.html",
            "/haulwise/",
            "/haulwise/index.html",
            "/haulwise/demo.html"
        ];
        const navigationDocuments = new Map();
        for (const page of navigationPages) {
            const result = await request(page);
            assert.equal(result.status, 200, `Navigation page is unavailable: ${page}`);
            navigationDocuments.set(page, result.body);
        }

        for (const [page, html] of navigationDocuments) {
            const links = html.matchAll(/<a\b[^>]*\bhref=(["'])(.*?)\1/gi);
            for (const [, , href] of links) {
                const target = new URL(href, `${origin}${page}`);
                if (!["http:", "https:"].includes(target.protocol) || target.origin !== origin) continue;

                const targetPage = await request(`${target.pathname}${target.search}`);
                assert.equal(targetPage.status, 200, `Broken navigation link: ${page} -> ${href}`);
                if (target.hash) {
                    const targetHtml = navigationDocuments.get(target.pathname) || targetPage.body;
                    const fragment = decodeURIComponent(target.hash.slice(1));
                    assert.ok(
                        targetHtml.includes(`id="${fragment}"`) || targetHtml.includes(`id='${fragment}'`),
                        `Missing navigation target: ${page} -> ${href}`
                    );
                }
            }
        }

        for (const removedPage of [
            "/haulwise/account.html",
            "/haulwise/admin.html",
            "/haulwise/admin-setup.html",
            "/haulwise/checkout.html",
            "/haulwise/subscriptions.html",
            "/api/auth/login",
            "/api/auth/register",
            "/api/account/data"
        ]) {
            assert.equal((await request(removedPage)).status, 404, `Removed feature still responds: ${removedPage}`);
        }

        const demo = navigationDocuments.get("/haulwise/demo.html");
        assert.doesNotMatch(demo, /account\.html|sign.?up|log.?in|payroll|team &amp; roles|DOT \/ ELD/i);
        assert.match(demo, /id="route-map"/);
        assert.match(demo, /id="preview-route"/);
        assert.match(demo, /sent to those providers, not Haulwise/);
        assert.equal((await request("/haulwise/vendor/leaflet/leaflet.js")).status, 200);
        assert.equal((await request("/haulwise/vendor/leaflet/leaflet.css")).status, 200);
        const appJs = fs.readFileSync(path.resolve(__dirname, "..", "app.js"), "utf8");
        assert.match(appJs, /function downloadTripCsv\(trip\)/);
        assert.match(appJs, /createTripCsv\(trip, data\.truck\)/);
        assert.match(appJs, /data\.trips = \[\]/);
        assert.match(appJs, /nominatim\.openstreetmap\.org/);
        assert.match(appJs, /router\.project-osrm\.org/);
        assert.doesNotMatch(appJs, /fetch\(["'`]\/api\/|data\.trips\.push/);

        const tripFile = createTripCsv({
            date: "2026-01-15T12:00:00.000Z",
            company: "Demo, Freight",
            reference: "=1+1",
            origin: "Columbus, OH",
            originAddress: "1 Start St",
            destination: "Cleveland, OH",
            address: "2 End St",
            entry: "Use gate \"A\"",
            start: 100,
            end: 250
        }, { name: "Test Truck", unit: "9", plate: "" });
        assert.equal(tripFile.filename, "haulwise-trip-2026-01-15-1-1.csv");
        assert.ok(tripFile.contents.startsWith("\uFEFF\"Date\",\"Company / load\""));
        assert.match(tripFile.contents, /"Demo, Freight"/);
        assert.match(tripFile.contents, /"Use gate ""A"""/);
        assert.match(tripFile.contents, /"150"/);
        assert.match(tripFile.contents, /"'=1\+1"/);

        const databaseFile = path.resolve(__dirname, "..", ".haulwise-data", "haulwise.sqlite");
        assert.equal(fs.existsSync(databaseFile), false, "The public server must not create a trip database.");

        console.log("Free public pages, CSV exports, privacy, and no-database checks passed.");
    } finally {
        if (server.exitCode === null) {
            const stopped = new Promise((resolve) => server.once("exit", resolve));
            server.kill("SIGTERM");
            await stopped;
        }
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
