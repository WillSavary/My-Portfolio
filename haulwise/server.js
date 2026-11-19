"use strict";

const path = require("node:path");
const express = require("express");
const helmet = require("helmet");

const app = express();
const port = Number(process.env.PORT) || 3000;
const siteRoot = path.resolve(__dirname, "..");

app.disable("x-powered-by");
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
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

app.use(express.static(siteRoot, { dotfiles: "deny", index: "index.html" }));

app.listen(port, () => {
    console.log(`Haulwise free local workspace listening at http://localhost:${port}/haulwise/`);
    console.log("Trip records are downloaded by the browser and are not stored by the server.");
});
