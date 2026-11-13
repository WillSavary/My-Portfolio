// Keep the sample catalog in one place so all three shop pages show matching details.
const products = new Map([
    ["Sunday stoneware mug", {
        price: 26,
        image: "images/stoneware-mug.jpg",
        alt: "White stoneware mug on a simple pale surface"
    }],
    ["Everyday plate set", {
        price: 42,
        image: "images/stacked-ceramics.jpg",
        alt: "Stacked ceramic plates and bowls in soft blue and white"
    }],
    ["Bud vase pair", {
        price: 38,
        image: "images/vase-styling.jpg",
        alt: "Pair of white ceramic vases arranged with flowering branches"
    }]
]);
const storageKey = "morrow-demo-bag";
const bag = loadBag();
const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
});

function loadBag() {
    const savedBag = localStorage.getItem(storageKey);

    if (!savedBag) {
        return new Map();
    }

    const savedItems = JSON.parse(savedBag);

    if (!savedItems || Array.isArray(savedItems) || typeof savedItems !== "object") {
        throw new Error("The saved demo bag has an invalid format.");
    }

    return new Map(Object.entries(savedItems).map(([name, quantity]) => {
        const product = products.get(name);

        if (!product || !Number.isInteger(quantity) || quantity < 1) {
            throw new Error(`The saved demo bag contains an invalid item: ${name}.`);
        }

        return [name, { ...product, quantity }];
    }));
}

function saveBag() {
    const savedItems = Object.fromEntries(
        [...bag].map(([name, item]) => [name, item.quantity])
    );

    localStorage.setItem(storageKey, JSON.stringify(savedItems));
}

function getBagTotals() {
    const items = [...bag.values()];
    const quantity = items.reduce((total, item) => total + item.quantity, 0);
    const subtotal = items.reduce((total, item) => total + item.price * item.quantity, 0);

    return { quantity, subtotal };
}

function renderBagSummary() {
    const { quantity, subtotal } = getBagTotals();

    document.querySelectorAll("[data-bag-count]").forEach((counter) => {
        counter.textContent = String(quantity);
        counter.setAttribute("aria-label", `${quantity} ${quantity === 1 ? "item" : "items"}`);
    });

    document.querySelectorAll("[data-bag-subtotal]").forEach((element) => {
        element.textContent = money.format(subtotal);
    });

    document.querySelectorAll("[data-bag-total]").forEach((element) => {
        element.textContent = money.format(subtotal);
    });

    const headingCount = document.querySelector("#cart-heading-count");
    if (headingCount) {
        headingCount.textContent = `(${quantity})`;
    }
}

function renderCartItems() {
    const cartItems = document.querySelector("#cart-items");
    if (!cartItems) {
        return;
    }

    const emptyState = document.querySelector("#cart-empty");
    const hasItems = bag.size > 0;
    emptyState.hidden = hasItems;
    cartItems.hidden = !hasItems;
    cartItems.replaceChildren();

    for (const [name, item] of bag) {
        const row = document.createElement("li");
        const image = document.createElement("img");
        const details = document.createElement("div");
        const title = document.createElement("h3");
        const unitPrice = document.createElement("p");
        const controls = document.createElement("div");
        const decrease = document.createElement("button");
        const quantity = document.createElement("span");
        const increase = document.createElement("button");
        const lineTotal = document.createElement("strong");
        const remove = document.createElement("button");

        row.className = "cart-item";
        image.className = "cart-item__image";
        image.src = item.image;
        image.alt = item.alt;
        image.width = 120;
        image.height = 120;
        details.className = "cart-item__details";
        title.textContent = name;
        unitPrice.textContent = `${money.format(item.price)} each`;
        controls.className = "quantity-controls";
        decrease.className = "quantity-button";
        decrease.type = "button";
        decrease.dataset.cartAction = "decrease";
        decrease.dataset.product = name;
        decrease.textContent = "−";
        decrease.setAttribute("aria-label", `Remove one ${name}`);
        quantity.className = "quantity-controls__value";
        quantity.textContent = String(item.quantity);
        increase.className = "quantity-button";
        increase.type = "button";
        increase.dataset.cartAction = "increase";
        increase.dataset.product = name;
        increase.textContent = "+";
        increase.setAttribute("aria-label", `Add one ${name}`);
        lineTotal.className = "cart-item__total";
        lineTotal.textContent = money.format(item.price * item.quantity);
        remove.className = "remove-button";
        remove.type = "button";
        remove.dataset.cartAction = "remove";
        remove.dataset.product = name;
        remove.textContent = "Remove";

        controls.append(decrease, quantity, increase);
        details.append(title, unitPrice, controls);
        row.append(image, details, lineTotal, remove);
        cartItems.append(row);
    }
}

function renderCheckoutItems() {
    const checkoutItems = document.querySelector("#checkout-items");
    if (!checkoutItems) {
        return;
    }

    checkoutItems.replaceChildren();

    for (const [name, item] of bag) {
        const row = document.createElement("li");
        const description = document.createElement("span");
        const lineTotal = document.createElement("strong");

        description.textContent = `${name} × ${item.quantity}`;
        lineTotal.textContent = money.format(item.price * item.quantity);
        row.append(description, lineTotal);
        checkoutItems.append(row);
    }
}

function updateCart(name, action) {
    const item = bag.get(name);
    if (!item) {
        throw new Error(`Cannot update a product that is not in the demo bag: ${name}.`);
    }

    if (action === "increase") {
        item.quantity += 1;
    } else if (action === "decrease" && item.quantity > 1) {
        item.quantity -= 1;
    } else {
        bag.delete(name);
    }

    saveBag();
    renderAll();

    const status = document.querySelector("#cart-status");
    if (status) {
        status.textContent = `${name} updated in your bag.`;
    }
}

function renderAll() {
    renderBagSummary();
    renderCartItems();
    renderCheckoutItems();

    const checkoutEmpty = document.querySelector("#checkout-empty");
    const checkoutContent = document.querySelector("#checkout-content");

    if (checkoutEmpty && checkoutContent) {
        const hasItems = bag.size > 0;
        checkoutEmpty.hidden = hasItems;
        checkoutContent.hidden = !hasItems;
    }
}

document.querySelectorAll(".add-button").forEach((button) => {
    button.addEventListener("click", () => {
        const name = button.dataset.product;
        const product = products.get(name);
        const price = Number(button.dataset.price);

        if (!product || price !== product.price) {
            throw new Error(`The demo product details are invalid: ${name}.`);
        }

        const existing = bag.get(name);
        if (existing) {
            existing.quantity += 1;
        } else {
            bag.set(name, { ...product, quantity: 1 });
        }

        saveBag();
        renderAll();

        const status = document.querySelector("#store-status");
        if (status) {
            status.textContent = `${name} added to your bag.`;
        }
    });
});

const cartItems = document.querySelector("#cart-items");
if (cartItems) {
    cartItems.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-cart-action]");
        if (button) {
            updateCart(button.dataset.product, button.dataset.cartAction);
        }
    });
}

const checkoutForm = document.querySelector("#checkout-form");
if (checkoutForm) {
    checkoutForm.addEventListener("submit", (event) => {
        event.preventDefault();

        if (bag.size === 0) {
            throw new Error("Cannot preview checkout with an empty demo bag.");
        }

        const status = document.querySelector("#checkout-status");
        status.textContent = "Demo complete. No details were sent or saved, and no payment was taken.";
        checkoutForm.querySelector("button[type='submit']").disabled = true;
    });
}

renderAll();
