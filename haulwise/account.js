"use strict";

const tabs = document.querySelectorAll("[data-tab]");
const signInForm = document.querySelector("#signin-form");
const signUpForm = document.querySelector("#signup-form");
const accountMessage = document.querySelector("#account-message");

function showMessage(message, isError) {
    accountMessage.textContent = message;
    accountMessage.classList.add("is-visible");
    accountMessage.classList.toggle("is-error", Boolean(isError));
}

function selectTab(name) {
    const isSignIn = name === "signin";
    signInForm.hidden = !isSignIn;
    signUpForm.hidden = isSignIn;
    accountMessage.classList.remove("is-visible");
    tabs.forEach((tab) => {
        const selected = tab.dataset.tab === name;
        tab.classList.toggle("is-active", selected);
        tab.setAttribute("aria-selected", String(selected));
    });
}

tabs.forEach((tab) => tab.addEventListener("click", () => selectTab(tab.dataset.tab)));
selectTab(window.location.hash === "#signup" ? "signup" : "signin");

async function postJson(url, payload) {
    const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    let result = {};
    try {
        result = await response.json();
    } catch {
        result = {};
    }
    if (!response.ok) throw new Error(result.error || `The server returned ${response.status}.`);
    return result;
}

signInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = signInForm.querySelector("button[type='submit']");
    button.disabled = true;
    const values = new FormData(signInForm);
    try {
        await postJson("/api/auth/login", {
            identifier: values.get("identifier"),
            password: values.get("password")
        });
        signInForm.reset();
        window.location.assign("demo.html");
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
});

const accountType = document.querySelector("#account-type");
const driverFields = document.querySelector("#driver-fields");
const ownerNote = document.querySelector("#owner-note");
const businessFields = document.querySelector("#business-fields");

function updateAccountType() {
    const type = accountType.value;
    driverFields.hidden = type !== "driver";
    ownerNote.hidden = type !== "owner";
    businessFields.hidden = type !== "company";
    signUpForm.elements.invite.required = type === "driver";
    signUpForm.elements["business-name"].required = type === "company";
    document.querySelector("#signup-submit").textContent = type === "driver"
        ? "Join company"
        : type === "owner" ? "Request independent account" : "Request company workspace";
}

accountType.addEventListener("change", updateAccountType);
updateAccountType();

signUpForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = new FormData(signUpForm);
    const type = accountType.value;
    const button = document.querySelector("#signup-submit");
    button.disabled = true;
    try {
        const result = await postJson("/api/auth/register", {
            accountType: type,
            inviteCode: values.get("invite"),
            companyName: values.get("business-name"),
            businessEmail: values.get("business-email"),
            businessKind: values.get("business-kind"),
            dotNumber: values.get("dot"),
            name: values.get("name"),
            email: values.get("email"),
            password: values.get("password")
        });
        signUpForm.reset();
        updateAccountType();
        showMessage(result.message, false);
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
});
