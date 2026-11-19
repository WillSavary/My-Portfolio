"use strict";

const { spawn } = require("node:child_process");

const port = 3101;
const server = spawn(process.execPath, ["server.js"], {
    cwd: require("node:path").resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(port), APP_BASE_URL: `http://localhost:${port}` },
    stdio: ["ignore", "pipe", "pipe"]
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path) {
    const response = await fetch(`http://localhost:${port}${path}`);
    return { status: response.status, body: await response.text() };
}

(async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
            await request("/api/admin/setup-status");
            break;
        } catch {
            await wait(100);
        }
        if (attempt === 29) throw new Error("Test server did not start.");
    }

    const setup = await request("/api/admin/setup-status");
    if (setup.status !== 200) throw new Error("Setup status endpoint failed.");

    const parsedSetup = JSON.parse(setup.body);
    if (parsedSetup.configured !== false) throw new Error("Existing owner account unexpectedly remains.");

    const publicPage = await request("/haulwise/index.html");
    if (publicPage.status !== 200) throw new Error("Haulwise public page failed.");

    const privatePage = await request("/haulwise/api.js");
    if (privatePage.status !== 404) throw new Error("Private server source was publicly accessible.");

    console.log("Integration smoke checks passed.");
    server.kill("SIGTERM");
})().catch((error) => {
    console.error(error.message);
    server.kill("SIGTERM");
    process.exitCode = 1;
});
