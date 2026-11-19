# Haulwise free trip tools

Haulwise is a free, browser-based workspace. No account, sign-up, login, subscription, or payment is required.

## Run locally

Install Node.js 20 or newer. From this directory:

```text
npm install
npm start
```

Open `http://localhost:3000/haulwise/`. The Express server serves static pages only; it has no account API or database.

## Trip privacy and downloads

When a trip is submitted, Haulwise downloads a CSV file to the user's device and clears the trip from the app. Trip records are not written to browser storage or sent to the server. Older locally saved trip histories are cleared when the workspace opens.

Truck details and saved facilities are kept only in the current browser so they can be reused. They are never uploaded. Clearing the browser's site data removes those details.

The CSV is the user's copy; keep it somewhere safe if it is needed later. Browser download settings may ask where to save each file.

## Live map and route preview

The trip page includes an OpenStreetMap live map. Drivers can explicitly start foreground GPS tracking; the map follows their position and can be recentered. Tracking stops when they leave the trip view, hide the page, or press Stop.

Selecting **Preview route** geocodes typed addresses with Nominatim and requests a driving route from the public OSRM service. Map tiles come from OpenStreetMap. Loading or moving the map can reveal the approximate viewed area to its tile servers; route preview sends the current coordinates or entered addresses to Nominatim and OSRM. Opening Google Maps shares the destination and any typed start point; Google may use the device location. Haulwise does not receive or save these locations. Public services may be limited or unavailable.

The preview is static: it does not reroute as GPS moves, is not truck-certified, and provides no turn-by-turn guidance. Use a truck-suitable navigation app, confirm restrictions and dock access with dispatch or the receiver, set up navigation before driving, and do not interact with this page while driving. The driver can also share or copy route details for a chosen navigation app.
