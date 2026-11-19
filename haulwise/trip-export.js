"use strict";

function createTripCsv(trip, truck) {
    const rows = [
        ["Date", "Company / load", "Trip reference", "Pickup area", "Pickup address", "Delivery facility", "Gate / dock address", "Instructions", "Start odometer (mi)", "End odometer (mi)", "Trip miles", "Truck", "Unit", "License plate"],
        [
            trip.date,
            trip.company,
            trip.reference,
            trip.origin,
            trip.originAddress,
            trip.destination,
            trip.address,
            trip.entry,
            trip.start,
            trip.end,
            trip.end - trip.start,
            truck.name,
            truck.unit,
            truck.plate
        ]
    ];
    const csv = rows.map((row) => row.map((value) => {
        const text = String(value ?? "");
        const safeText = /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
        return `"${safeText.replace(/"/g, '""')}"`;
    }).join(",")).join("\r\n");
    const reference = String(trip.reference || "")
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "trip";
    return {
        filename: `haulwise-trip-${String(trip.date).slice(0, 10)}-${reference}.csv`,
        contents: `\uFEFF${csv}`
    };
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { createTripCsv };
}
