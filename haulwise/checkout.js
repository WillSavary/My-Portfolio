"use strict";

const radios = document.querySelectorAll("input[name='plan']");
const title = document.querySelector("#summary-title");
const summaryPlan = document.querySelector("#summary-plan");
const summaryBilling = document.querySelector("#summary-billing");
const summaryPrice = document.querySelector("#summary-price");
const checkoutNext = document.querySelector("#checkout-next");

function updatePlan(plan) {
    const isFleet = plan === "fleet";
    const name = isFleet ? "Fleet" : "Driver";
    title.textContent = `${name} plan`;
    summaryPlan.textContent = name;
    summaryBilling.textContent = isFleet ? "Monthly" : "No charge";
    summaryPrice.textContent = isFleet ? "$49 / mo*" : "$0";
    checkoutNext.href = isFleet ? "../contact.html" : "account.html#signup";
    checkoutNext.textContent = isFleet ? "Continue to Stripe checkout →" : "Continue to driver sign-up preview →";
}

radios.forEach((radio) => radio.addEventListener("change", () => {
    document.querySelector("#checkout-message").classList.remove("is-visible", "is-error");
    updatePlan(radio.value);
}));

checkoutNext.addEventListener("click", async (event) => {
    const selectedPlan = document.querySelector("input[name='plan']:checked").value;
    if (selectedPlan !== "fleet") return;

    event.preventDefault();
    const message = document.querySelector("#checkout-message");
    checkoutNext.setAttribute("aria-disabled", "true");
    checkoutNext.textContent = "Connecting to secure checkout…";
    message.classList.remove("is-error");
    message.classList.add("is-visible");
    message.textContent = "Checking whether secure checkout is configured…";

    try {
        const response = await fetch("/api/billing/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan: "fleet" })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Secure checkout is not available yet.");
        if (typeof result.url !== "string" || new URL(result.url).origin !== "https://checkout.stripe.com") {
            throw new Error("The billing service returned an invalid checkout destination.");
        }
        window.location.assign(result.url);
    } catch (error) {
        message.classList.add("is-error");
        message.textContent = error instanceof TypeError
            ? "The secure billing server is unavailable. No payment was made."
            : error.message;
    } finally {
        checkoutNext.removeAttribute("aria-disabled");
        updatePlan(selectedPlan);
    }
});

const checkoutMessage = new URLSearchParams(window.location.search).get("checkout");
if (checkoutMessage === "cancelled") {
    const message = document.querySelector("#checkout-message");
    message.classList.add("is-visible");
    message.textContent = "Checkout was canceled. No payment was made.";
}

const requestedPlan = new URLSearchParams(window.location.search).get("plan");
const requestedOption = Array.from(radios).find((radio) => radio.value === requestedPlan);
if (requestedOption) {
    requestedOption.checked = true;
    updatePlan(requestedOption.value);
}
