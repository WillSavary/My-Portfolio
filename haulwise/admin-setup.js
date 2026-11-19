"use strict";

const setupForm = document.querySelector("#owner-setup-form");
const setupMessage = document.querySelector("#owner-setup-message");

function showSetupMessage(message, isError) {
    setupMessage.textContent = message;
    setupMessage.classList.add("is-visible");
    setupMessage.classList.toggle("is-error", Boolean(isError));
}

setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = setupForm.querySelector("button[type='submit']");
    button.disabled = true;
    const values = new FormData(setupForm);
    try {
        const response = await fetch("/api/admin/bootstrap", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                setupToken: values.get("setupToken"),
                username: values.get("username"),
                email: values.get("email"),
                password: values.get("password")
            })
        });
        let result = {};
        try {
            result = await response.json();
        } catch {
            result = {};
        }
        if (!response.ok) throw new Error(result.error || "Owner setup could not be completed.");
        setupForm.reset();
        showSetupMessage("Owner account created. Continue to the private owner console to sign in.", false);
        window.location.assign("admin.html");
    } catch (error) {
        showSetupMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
});
