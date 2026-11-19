"use strict";

const STORAGE_KEY = "haulwise-browser-demo-v1";
const defaultData = {
    truck: { name: "", unit: "", plate: "" },
    trips: [],
    facilities: []
};

let previousTripsDetected = false;

function readData() {
    let saved;
    try {
        saved = localStorage.getItem(STORAGE_KEY);
    } catch {
        return structuredClone(defaultData);
    }
    if (saved === null) {
        return structuredClone(defaultData);
    }
    let data;
    try {
        data = JSON.parse(saved);
    } catch {
        localStorage.removeItem(STORAGE_KEY);
        return structuredClone(defaultData);
    }
    if (!data || !Array.isArray(data.trips) || typeof data.truck !== "object") {
        localStorage.removeItem(STORAGE_KEY);
        return structuredClone(defaultData);
    }
    if (!Array.isArray(data.facilities)) data.facilities = [];
    previousTripsDetected = data.trips.length > 0;
    data.trips = [];
    return data;
}

let data = readData();
const statusMessage = document.querySelector("#status-message");
let currentRouteStart = null;
let liveLocationWatch = null;

if (previousTripsDetected) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error("Could not clear previous local trip history:", error);
        showStatus("Previous trip history could not be cleared from this browser. Clear this site's stored data before continuing.", true);
    }
}

function saveData() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            truck: data.truck,
            trips: [],
            facilities: data.facilities
        }));
    } catch {
        showStatus("Browser storage is unavailable. Changes will remain only until this page closes.", true);
    }
}

function downloadTripCsv(trip) {
    const file = createTripCsv(trip, data.truck);
    const blob = new Blob([file.contents], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function showStatus(message, isError) {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.classList.add("is-visible");
    statusMessage.classList.toggle("is-error", Boolean(isError));
}

function formatNumber(number) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number);
}

function tripMiles(trip) {
    return Math.max(0, Number(trip.end) - Number(trip.start));
}

function showRouteStatus(message, isError) {
    const routeStatus = document.querySelector("#route-status");
    routeStatus.textContent = message;
    routeStatus.classList.toggle("is-error", Boolean(isError));
}

function getFacilityById(id) {
    return data.facilities.find((facility) => facility.id === id);
}

function applyFacility(facility, destinationInput, notesInput) {
    destinationInput.value = facility.address;
    if (notesInput) notesInput.value = facility.notes || "";
}

function makeTripRow(trip) {
    const row = document.createElement("article");
    const icon = document.createElement("span");
    const main = document.createElement("div");
    const company = document.createElement("strong");
    const detail = document.createElement("span");
    const miles = document.createElement("strong");
    const rowDetail = document.createElement("div");
    const route = document.createElement("span");
    const routeButton = document.createElement("button");

    row.className = "trip-row";
    icon.className = "trip-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "↗";
    main.className = "trip-main";
    company.textContent = trip.company;
    const date = new Date(trip.date);
    detail.textContent = `${trip.reference ? `${trip.reference} · ` : ""}${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
    miles.className = "trip-mileage";
    miles.textContent = `${formatNumber(tripMiles(trip))} mi`;
    rowDetail.className = "trip-detail";
    routeButton.type = "button";
    routeButton.className = "route-trip-button";
    if (trip.id === "sample-trip") {
        route.textContent = "Demo sample only · not a navigable address";
        routeButton.textContent = "Sample only";
        routeButton.disabled = true;
    } else {
        route.textContent = `${trip.originAddress || trip.origin} → ${trip.address || trip.destination}`;
        routeButton.textContent = "Plan route →";
        routeButton.setAttribute("aria-label", `Plan route from ${trip.originAddress || trip.origin} to ${trip.address || trip.destination}`);
        routeButton.addEventListener("click", () => openTripRoute(trip));
    }
    main.append(company, detail);
    rowDetail.append(route, routeButton);
    row.append(icon, main, miles, rowDetail);
    return row;
}

function makeFacilityRow(facility) {
    const row = document.createElement("article");
    const details = document.createElement("div");
    const name = document.createElement("strong");
    const address = document.createElement("span");
    const notes = document.createElement("span");
    const actions = document.createElement("div");
    const useButton = document.createElement("button");
    const editButton = document.createElement("button");
    const deleteButton = document.createElement("button");

    row.className = "facility-row";
    details.className = "facility-details";
    name.textContent = facility.name;
    address.textContent = `${facility.address} · ${facility.country === "CA" ? "Canada" : "United States"}`;
    const verificationDate = new Date(facility.verifiedAt);
    const verifiedLabel = Number.isNaN(verificationDate.getTime())
        ? "Driver-confirmed entrance"
        : `Driver-confirmed · ${verificationDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    notes.textContent = `${facility.notes ? `Entrance: ${facility.notes} · ` : ""}${verifiedLabel}`;
    details.append(name, address, notes);
    actions.className = "facility-actions";
    useButton.type = "button";
    useButton.className = "text-button";
    useButton.textContent = "Use for route";
    useButton.addEventListener("click", () => {
        applyFacility(facility, document.querySelector("#route-destination"), document.querySelector("#route-entry-notes"));
        document.querySelector("#route-facility-select").value = facility.id;
        showRouteStatus(`${facility.name} loaded as the route destination. Confirm the entrance before departure.`, false);
        document.querySelector("#route-start").focus();
    });
    editButton.type = "button";
    editButton.className = "text-button";
    editButton.textContent = "Edit";
    editButton.addEventListener("click", () => editFacility(facility));
    deleteButton.type = "button";
    deleteButton.className = "text-button facility-delete";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => {
        if (!window.confirm(`Remove ${facility.name} from this browser's saved facilities?`)) return;
        data.facilities = data.facilities.filter((saved) => saved.id !== facility.id);
        saveData();
        renderFacilities();
        showStatus("Facility removed from this browser.", false);
    });
    actions.append(useButton, editButton, deleteButton);
    row.append(details, actions);
    return row;
}

function renderFacilities() {
    const list = document.querySelector("#saved-facilities");
    const routeSelect = document.querySelector("#route-facility-select");
    const tripSelect = document.querySelector("#trip-facility-select");
    const searchTerm = document.querySelector("#facility-search").value.trim().toLocaleLowerCase();
    const routeSelection = routeSelect.value;
    const tripSelection = tripSelect.value;

    for (const select of [routeSelect, tripSelect]) {
        select.replaceChildren(new Option("Enter a new destination", ""));
        data.facilities.forEach((facility) => {
            const countryName = facility.country === "CA" ? "Canada" : "United States";
            select.add(new Option(`${facility.name} · ${countryName}`, facility.id));
        });
    }
    if (getFacilityById(routeSelection)) routeSelect.value = routeSelection;
    if (getFacilityById(tripSelection)) tripSelect.value = tripSelection;

    list.replaceChildren();
    const visibleFacilities = data.facilities.filter((facility) =>
        `${facility.name} ${facility.address} ${facility.notes || ""} ${facility.country}`.toLocaleLowerCase().includes(searchTerm)
    );
    if (visibleFacilities.length === 0) {
        const empty = document.createElement("p");
        empty.className = "empty-state";
        empty.textContent = searchTerm
            ? "No saved facilities match that search."
            : "No saved facilities yet. Add a verified gate or dock to reuse it on future trips.";
        list.append(empty);
        return;
    }
    visibleFacilities.forEach((facility) => list.append(makeFacilityRow(facility)));
}

function renderTrips() {
    const recent = document.querySelector("#recent-trips");
    const all = document.querySelector("#all-trips");
    const trips = [...data.trips].sort((a, b) => new Date(b.date) - new Date(a.date));

    document.querySelector("#metric-miles").textContent = "CSV";
    document.querySelector("#metric-trips").textContent = formatNumber(trips.length);
    document.querySelector("#metric-truck").textContent = data.truck.name || "Not set";
    document.querySelector("#metric-truck-sub").textContent = data.truck.unit ? `Unit ${data.truck.unit}` : "Add a unit number";
    document.querySelector("#trip-count").textContent = `${trips.length} trips retained`;

    for (const [container, list] of [[recent, trips.slice(0, 3)], [all, trips]]) {
        container.replaceChildren();
        if (list.length === 0) {
            const empty = document.createElement("p");
            empty.className = "empty-state";
            empty.textContent = "No trips are kept here. Complete a trip to download its CSV file.";
            container.append(empty);
        } else {
            list.forEach((trip) => container.append(makeTripRow(trip)));
        }
    }

    const nameInput = document.querySelector("#truck-form [name='name']");
    if (nameInput && document.activeElement !== nameInput) nameInput.value = data.truck.name || "";
    const unitInput = document.querySelector("#truck-form [name='unit']");
    if (unitInput && document.activeElement !== unitInput) unitInput.value = data.truck.unit || "";
    const plateInput = document.querySelector("#truck-form [name='plate']");
    if (plateInput && document.activeElement !== plateInput) plateInput.value = data.truck.plate || "";
    renderFacilities();
}

function showView(view) {
    if (view !== "trips") stopLiveLocation("Live GPS stopped when you left the trip view. Your last fix is not saved.");
    document.querySelectorAll(".view-panel").forEach((panel) => {
        panel.hidden = panel.id !== `view-${view}`;
    });
    document.querySelectorAll(".nav-link[data-view]").forEach((button) => {
        button.classList.toggle("is-active", button.dataset.view === view);
    });
    const heading = document.querySelector(`#view-${view} h2`);
    if (heading) heading.setAttribute("tabindex", "-1"), heading.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
}

function openTripRoute(trip) {
    showView("trips");
    stopLiveLocation("");
    currentRouteStart = null;
    document.querySelector("#open-current-map").hidden = true;
    document.querySelector("#route-start").value = trip.originAddress || trip.origin || "";
    document.querySelector("#route-destination").value = trip.address || "";
    document.querySelector("#route-entry-notes").value = trip.entry || "";
    const facility = data.facilities.find((saved) => saved.address === trip.address);
    document.querySelector("#route-facility-select").value = facility ? facility.id : "";
    showRouteStatus("Trip addresses loaded. Confirm the truck entrance with dispatch before sharing.", false);
    document.querySelector("#route-start").focus();
}

function openTripForm() {
    showView("trips");
    document.querySelector("#trip-form").hidden = false;
    document.querySelector("#trip-form [name='company']").focus();
}

function editFacility(facility) {
    const form = document.querySelector("#facility-form");
    form.elements.name.value = facility.name;
    form.elements.country.value = facility.country;
    form.elements.address.value = facility.address;
    form.elements.notes.value = facility.notes || "";
    form.elements.verified.checked = false;
    form.dataset.editingId = facility.id;
    form.hidden = false;
    form.elements.name.focus();
}

function routeShareText() {
    const start = document.querySelector("#route-start").value.trim();
    const destination = document.querySelector("#route-destination").value.trim();
    const notes = document.querySelector("#route-entry-notes").value.trim();
    if (!start || !destination) {
        showRouteStatus("Enter both a start point and the exact gate or dock address first.", true);
        return null;
    }

    const facility = getFacilityById(document.querySelector("#route-facility-select").value);
    const startText = currentRouteStart
        ? `Approximate current position: ${currentRouteStart.latitude.toFixed(5)}, ${currentRouteStart.longitude.toFixed(5)} (accuracy ±${Math.round(currentRouteStart.accuracy)} m)`
        : start;
    return [
        "Haulwise route details",
        `Start: ${startText}`,
        facility ? `Receiver: ${facility.name}` : "",
        `Drop-off gate/dock: ${destination}`,
        notes ? `Entrance instructions: ${notes}` : "",
        "Confirm truck restrictions and the correct entrance with dispatch or the receiver."
    ].filter(Boolean).join("\n");
}

async function shareRoute() {
    const details = routeShareText();
    if (!details) return;
    const preview = document.querySelector("#route-share-text");
    preview.textContent = details;
    preview.hidden = false;

    if (typeof navigator.share !== "function") {
        showRouteStatus("This browser has no app share sheet. Copy the route details below and paste them into your truck-navigation app.", true);
        return;
    }
    try {
        await navigator.share({ title: "Haulwise route details", text: details });
        showRouteStatus("Route details shared. Check the selected navigation app's vehicle settings and route before driving.", false);
    } catch (error) {
        if (error.name === "AbortError") {
            showRouteStatus("Sharing canceled. Your route details are still shown below.", false);
            return;
        }
        showRouteStatus("Could not open the app share sheet. Copy the route details below instead.", true);
    }
}

async function copyRoute() {
    const details = routeShareText();
    if (!details) return;
    const preview = document.querySelector("#route-share-text");
    preview.textContent = details;
    preview.hidden = false;
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
        showRouteStatus("Clipboard access is unavailable. Select and copy the route details shown below.", true);
        return;
    }
    try {
        await navigator.clipboard.writeText(details);
        showRouteStatus("Route details copied. Paste them into your truck-navigation app and verify its vehicle profile.", false);
    } catch (error) {
        showRouteStatus("Could not access the clipboard. Select and copy the route details shown below.", true);
    }
}

document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
        showView(button.dataset.view);
    });
});

document.querySelector("#open-route-planner").addEventListener("click", () => {
    showView("trips");
    document.querySelector("#route-start").focus();
});

document.querySelector(".notice-close").addEventListener("click", () => {
    document.querySelector(".notice").hidden = true;
});

document.querySelector("#show-trip-form").addEventListener("click", openTripForm);
document.querySelector("#hide-trip-form").addEventListener("click", () => {
    document.querySelector("#trip-form").hidden = true;
});
document.querySelector("#cancel-trip").addEventListener("click", () => {
    document.querySelector("#trip-form").reset();
    document.querySelector("#trip-form").hidden = true;
});

function updateCurrentMapLink() {
    const mapLink = document.querySelector("#open-current-map");
    if (!currentRouteStart) {
        mapLink.hidden = true;
        return;
    }
    const { latitude, longitude } = currentRouteStart;
    mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
    mapLink.hidden = false;
}

function stopLiveLocation(message) {
    if (liveLocationWatch !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(liveLocationWatch);
        liveLocationWatch = null;
    }
    const startButton = document.querySelector("#use-current-location");
    const stopButton = document.querySelector("#stop-current-location");
    startButton.disabled = false;
    startButton.textContent = "◎ Start live GPS";
    stopButton.hidden = true;
    if (message) {
        const locationStatus = document.querySelector("#location-status");
        locationStatus.textContent = message;
        locationStatus.classList.remove("is-error");
    }
}

function displayLocationError(error) {
    stopLiveLocation("");
    const locationStatus = document.querySelector("#location-status");
    locationStatus.classList.add("is-error");
    if (error.code === 1 || error.code === error.PERMISSION_DENIED) {
        locationStatus.textContent = "Location permission was denied. Enter a start address manually.";
    } else if (error.code === 3 || error.code === error.TIMEOUT) {
        locationStatus.textContent = "GPS fix timed out. Try again or enter a start address.";
    } else {
        locationStatus.textContent = "Current location is unavailable. Enter a start address manually.";
    }
}

document.querySelector("#use-current-location").addEventListener("click", () => {
    const locationStatus = document.querySelector("#location-status");
    const routeStart = document.querySelector("#route-start");
    currentRouteStart = null;
    updateCurrentMapLink();
    if (routeStart.value.startsWith("Current location (")) routeStart.value = "";
    if (!navigator.geolocation) {
        locationStatus.textContent = "GPS is unavailable in this browser or page context. Use HTTPS or enter a start address.";
        locationStatus.classList.add("is-error");
        return;
    }

    const button = document.querySelector("#use-current-location");
    button.disabled = true;
    button.textContent = "Starting GPS…";
    document.querySelector("#stop-current-location").hidden = false;
    locationStatus.classList.remove("is-error");
    locationStatus.textContent = "Requesting location permission. Updates stay on this device and stop when you leave this view.";
    try {
        liveLocationWatch = navigator.geolocation.watchPosition((position) => {
            currentRouteStart = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : 0
            };
            routeStart.value = `Current location (${currentRouteStart.latitude.toFixed(5)}, ${currentRouteStart.longitude.toFixed(5)}; approx. ±${Math.round(currentRouteStart.accuracy)} m)`;
            button.textContent = "● GPS is live";
            locationStatus.textContent = `Live GPS · accuracy approx. ±${Math.round(currentRouteStart.accuracy)} m · not saved or sent to Haulwise.`;
            locationStatus.classList.remove("is-error");
            updateCurrentMapLink();
        }, displayLocationError, { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 });
    } catch {
        liveLocationWatch = null;
        button.disabled = false;
        document.querySelector("#stop-current-location").hidden = true;
        locationStatus.classList.add("is-error");
        locationStatus.textContent = "Could not start GPS. Enter a start address manually.";
    }
});

document.querySelector("#stop-current-location").addEventListener("click", () => {
    stopLiveLocation("Live GPS stopped. The last fix remains only in this page until you leave or edit the start point.");
});

document.querySelector("#route-start").addEventListener("input", () => {
    stopLiveLocation("");
    currentRouteStart = null;
    updateCurrentMapLink();
    const locationStatus = document.querySelector("#location-status");
    locationStatus.textContent = "";
    locationStatus.classList.remove("is-error");
});

document.addEventListener("visibilitychange", () => {
    if (document.hidden && liveLocationWatch !== null) {
        stopLiveLocation("Live GPS paused because this page is no longer visible. Start it again when ready.");
    }
});
window.addEventListener("pagehide", () => stopLiveLocation(""));

document.querySelector("#route-facility-select").addEventListener("change", (event) => {
    const facility = getFacilityById(event.currentTarget.value);
    if (facility) {
        applyFacility(facility, document.querySelector("#route-destination"), document.querySelector("#route-entry-notes"));
    } else {
        document.querySelector("#route-destination").value = "";
        document.querySelector("#route-entry-notes").value = "";
    }
});

document.querySelector("#route-destination").addEventListener("input", () => {
    const facilitySelect = document.querySelector("#route-facility-select");
    if (facilitySelect.value) {
        facilitySelect.value = "";
        document.querySelector("#route-entry-notes").value = "";
    }
});

document.querySelector("#trip-facility-select").addEventListener("change", (event) => {
    const facility = getFacilityById(event.currentTarget.value);
    if (!facility) {
        document.querySelector("#trip-form [name='destination']").value = "";
        document.querySelector("#trip-form [name='address']").value = "";
        document.querySelector("#trip-form [name='entry']").value = "";
        return;
    }
    document.querySelector("#trip-form [name='destination']").value = facility.name;
    document.querySelector("#trip-form [name='address']").value = facility.address;
    document.querySelector("#trip-form [name='entry']").value = facility.notes || "";
});

document.querySelector("#facility-search").addEventListener("input", renderFacilities);
document.querySelector("#share-route").addEventListener("click", shareRoute);
document.querySelector("#copy-route").addEventListener("click", copyRoute);
document.querySelector("#show-facility-form").addEventListener("click", () => {
    const form = document.querySelector("#facility-form");
    form.reset();
    delete form.dataset.editingId;
    form.hidden = false;
    form.elements.name.focus();
});
document.querySelector("#cancel-facility-form").addEventListener("click", () => {
    const form = document.querySelector("#facility-form");
    form.reset();
    delete form.dataset.editingId;
    form.hidden = true;
});

document.querySelector("#facility-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const editingFacility = getFacilityById(form.dataset.editingId);
    const facility = {
        id: editingFacility ? editingFacility.id : crypto.randomUUID(),
        name: String(values.get("name")).trim(),
        country: String(values.get("country")),
        address: String(values.get("address")).trim(),
        notes: String(values.get("notes")).trim(),
        verifiedAt: new Date().toISOString(),
        source: "driver-verified"
    };

    if (editingFacility) {
        data.facilities = data.facilities.map((saved) => saved.id === facility.id ? facility : saved);
    } else {
        data.facilities.push(facility);
    }
    saveData();
    form.reset();
    delete form.dataset.editingId;
    form.hidden = true;
    renderFacilities();
    showStatus("Verified facility saved in this browser only.", false);
});

document.querySelector("#trip-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const start = Number(values.get("start"));
    const end = Number(values.get("end"));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        showStatus("The ending odometer must be equal to or greater than the starting odometer.", true);
        form.elements.end.focus();
        return;
    }

    const trip = {
        company: String(values.get("company")).trim(),
        reference: String(values.get("reference")).trim(),
        origin: String(values.get("origin")).trim(),
        originAddress: String(values.get("originAddress")).trim(),
        destination: String(values.get("destination")).trim(),
        address: String(values.get("address")).trim(),
        entry: String(values.get("entry")).trim(),
        start,
        end,
        date: new Date().toISOString()
    };
    try {
        downloadTripCsv(trip);
    } catch (error) {
        console.error("Could not create trip download:", error);
        showStatus("Could not create the trip file. Nothing was saved; try again or check browser download settings.", true);
        return;
    }
    renderTrips();
    form.reset();
    form.hidden = true;
    showStatus("Trip downloaded as a CSV. It was not saved to the app or server.", false);
});

document.querySelector("#truck-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    data.truck = {
        name: String(values.get("name")).trim(),
        unit: String(values.get("unit")).trim(),
        plate: String(values.get("plate")).trim()
    };
    saveData();
    renderTrips();
    showStatus("Truck details saved to this browser's local demo.", false);
});

const today = new Date();
document.querySelector("#today-label").textContent = today.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
const greeting = today.getHours() < 12 ? "Good morning" : today.getHours() < 18 ? "Good afternoon" : "Good evening";
document.querySelector("#page-title").innerHTML = `${greeting}, Jordan <span aria-hidden="true">👋</span>`;
renderTrips();
