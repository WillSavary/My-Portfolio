"use strict";

const loginPanel = document.querySelector("#admin-login");
const dashboard = document.querySelector("#admin-dashboard");
const loginForm = document.querySelector("#admin-login-form");
const loginMessage = document.querySelector("#admin-login-message");
const dashboardMessage = document.querySelector("#admin-message");
const recordBody = document.querySelector("#records-body");
const recordHead = document.querySelector("#records-head");
const recordTabs = document.querySelector("#record-tabs");
let currentKind = "users";
let currentPage = 1;
let totalRecords = 0;

const columns = {
    users: [["Name", "name"], ["Username", "username"], ["Email", "email"], ["Role", "role"], ["Company", "company_name"], ["Status", "status"], ["Created", "created_at"]],
    companies: [["Company", "name"], ["Type", "type"], ["Contact email", "business_email"], ["Business type", "business_kind"], ["USDOT", "dot_number"], ["Users", "user_count"], ["Status", "status"], ["Created", "created_at"]],
    trucks: [["Truck", "name"], ["Unit", "unit"], ["Plate", "plate"], ["Driver", "driver_name"], ["Company", "company_name"], ["Updated", "updated_at"]],
    trips: [["Load / customer", "customer"], ["Reference", "reference"], ["Driver", "driver_name"], ["Company", "company_name"], ["Pickup", "origin_address"], ["Drop-off / dock", "destination_address"], ["Miles", "miles"], ["Date", "created_at"]],
    facilities: [["Facility", "name"], ["Country", "country"], ["Gate / dock address", "address"], ["Entrance notes", "notes"], ["Added by", "added_by"], ["Company", "company_name"]],
    activity: [["Action", "action"], ["Record", "entity_type"], ["Record ID", "entity_id"], ["Actor", "actor"], ["Company", "company_name"], ["Time", "created_at"]]
};

function showMessage(element, message, isError) {
    element.textContent = message;
    element.classList.add("is-visible");
    element.classList.toggle("is-error", Boolean(isError));
}

async function requestJson(url, options) {
    const response = await fetch(url, { credentials: "same-origin", ...options });
    let result = {};
    if (response.status !== 204) {
        try {
            result = await response.json();
        } catch {
            result = {};
        }
    }
    if (!response.ok) throw new Error(result.error || `The server returned ${response.status}.`);
    return result;
}

function showLogin() {
    loginPanel.hidden = false;
    dashboard.hidden = true;
}

async function showDashboard() {
    loginPanel.hidden = true;
    dashboard.hidden = false;
    try {
        await loadOverview();
        await loadRecords();
    } catch (error) {
        showMessage(dashboardMessage, error.message, true);
        showLogin();
    }
}

async function loadOverview() {
    const result = await requestJson("/api/admin/overview");
    const labels = {
        users: "Users",
        companies: "Companies",
        trucks: "Trucks",
        trips: "Trips / shipments",
        facilities: "Saved facilities",
        audit_events: "Audit events"
    };
    const metrics = document.querySelector("#admin-metrics");
    metrics.replaceChildren();
    Object.entries(result.counts).forEach(([key, count]) => {
        const card = document.createElement("article");
        const label = document.createElement("span");
        const value = document.createElement("strong");
        card.className = "admin-metric";
        label.textContent = labels[key] || key;
        value.textContent = new Intl.NumberFormat().format(count);
        card.append(label, value);
        metrics.append(card);
    });
}

async function loadRecords() {
    const result = await requestJson(`/api/admin/records/${currentKind}?page=${currentPage}`);
    totalRecords = result.total;
    document.querySelector("#record-count").textContent = `${new Intl.NumberFormat().format(totalRecords)} records`;
    document.querySelector("#records-heading").textContent = currentKind === "trips"
        ? "Trips / shipments"
        : currentKind === "activity" ? "Audit events" : currentKind[0].toUpperCase() + currentKind.slice(1);
    recordTabs.querySelectorAll("button").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.kind === currentKind);
    });

    recordHead.replaceChildren();
    const headerRow = document.createElement("tr");
    columns[currentKind].forEach(([label]) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = label;
        headerRow.append(cell);
    });
    if (currentKind === "users" || currentKind === "companies") {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.textContent = "Admin action";
        headerRow.append(cell);
    }
    recordHead.append(headerRow);
    recordBody.replaceChildren();

    if (!result.records.length) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = headerRow.children.length;
        cell.className = "empty-state";
        cell.textContent = "No server-backed records yet.";
        row.append(cell);
        recordBody.append(row);
    } else {
        result.records.forEach((record) => recordBody.append(makeRecordRow(record)));
    }

    const pageCount = Math.max(1, Math.ceil(totalRecords / result.pageSize));
    document.querySelector("#records-page").textContent = `Page ${currentPage} of ${pageCount}`;
    document.querySelector("#records-prev").disabled = currentPage <= 1;
    document.querySelector("#records-next").disabled = currentPage >= pageCount;
}

function makeRecordRow(record) {
    const row = document.createElement("tr");
    columns[currentKind].forEach(([, key]) => {
        const cell = document.createElement("td");
        const value = key === "miles"
            ? Number(record.odometer_end) - Number(record.odometer_start)
            : record[key];
        cell.textContent = value === null || value === undefined || value === ""
            ? "—"
            : key === "miles"
                ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Math.max(0, value))} mi`
                : key.endsWith("_at") && !Number.isNaN(new Date(value).getTime())
                    ? new Date(value).toLocaleString()
                    : String(value);
        row.append(cell);
    });
    if (currentKind === "users" || currentKind === "companies") {
        const cell = document.createElement("td");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "text-button";
        button.dataset.recordId = record.id;
        button.dataset.recordType = currentKind === "users" ? "user" : "company";
        button.dataset.nextStatus = record.status === "active" ? "suspended" : "active";
        button.textContent = record.status === "active" ? "Suspend" : "Approve / activate";
        if (currentKind === "users" && record.role === "owner") {
            button.disabled = true;
            button.textContent = "Owner protected";
        }
        cell.append(button);
        row.append(cell);
    }
    return row;
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = loginForm.querySelector("button[type='submit']");
    button.disabled = true;
    try {
        const values = new FormData(loginForm);
        await requestJson("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                identifier: values.get("identifier"),
                password: values.get("password")
            })
        });
        loginForm.reset();
        showMessage(loginMessage, "", false);
        await showDashboard();
    } catch (error) {
        showMessage(loginMessage, error.message, true);
    } finally {
        button.disabled = false;
    }
});

recordTabs.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-kind]");
    if (!button) return;
    currentKind = button.dataset.kind;
    currentPage = 1;
    try {
        await loadRecords();
    } catch (error) {
        showMessage(dashboardMessage, error.message, true);
    }
});

document.querySelector("#records-prev").addEventListener("click", async () => {
    currentPage = Math.max(1, currentPage - 1);
    try {
        await loadRecords();
    } catch (error) {
        showMessage(dashboardMessage, error.message, true);
    }
});

document.querySelector("#records-next").addEventListener("click", async () => {
    currentPage += 1;
    try {
        await loadRecords();
    } catch (error) {
        currentPage -= 1;
        showMessage(dashboardMessage, error.message, true);
    }
});

recordBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-record-id]");
    if (!button || button.disabled) return;
    const type = button.dataset.recordType;
    const id = encodeURIComponent(button.dataset.recordId);
    const endpoint = type === "user" ? "users" : "companies";
    try {
        await requestJson(`/api/admin/${endpoint}/${id}/status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: button.dataset.nextStatus })
        });
        showMessage(dashboardMessage, `${type === "user" ? "Account" : "Company"} status updated.`, false);
        await loadOverview();
        await loadRecords();
    } catch (error) {
        showMessage(dashboardMessage, error.message, true);
    }
});

document.querySelector("#admin-company-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
        const result = await requestJson("/api/admin/companies", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: values.get("name") })
        });
        form.reset();
        const output = document.querySelector("#admin-invite-output");
        output.textContent = `${result.company.name} invite code (shown once): ${result.inviteCode}`;
        output.hidden = false;
        showMessage(dashboardMessage, "Carrier workspace created. Copy and share its invite code privately.", false);
        currentKind = "companies";
        currentPage = 1;
        await loadOverview();
        await loadRecords();
    } catch (error) {
        showMessage(dashboardMessage, error.message, true);
    }
});

document.querySelector("#admin-signout").addEventListener("click", async () => {
    try {
        await requestJson("/api/auth/logout", { method: "POST" });
        showLogin();
    } catch (error) {
        showMessage(dashboardMessage, error.message, true);
    }
});

(async function initializeAdmin() {
    try {
        const result = await requestJson("/api/admin/overview");
        if (result) await showDashboard();
    } catch {
        showLogin();
        try {
            const setup = await requestJson("/api/admin/setup-status");
            if (!setup.configured && !setup.setupEnabled) {
                showMessage(loginMessage, "Owner setup is disabled. Configure a private bootstrap token on the server before first use.", true);
            } else if (!setup.configured) {
                showMessage(loginMessage, "No owner account exists yet. Complete the private one-time setup before signing in.", false);
            }
        } catch (error) {
            showMessage(loginMessage, error.message, true);
        }
    }
})();
