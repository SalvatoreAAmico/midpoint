# Tests

## Unit — geo, scoring, opening hours
```
node test/unit.mjs
```
No dependencies. 15 assertions covering distance, centroid, the fairness
score, `opening_hours` parsing, and price-tag reading.

## Smoke — the real UI in a headless browser
```
cd test && npm install && cd ..
node test/smoke.mjs
```
Serves the app locally and drives it in mobile-sized Chromium with **every
OpenStreetMap response mocked**, so it runs offline and deterministically.
27 assertions covering the person rows and the 4-person cap, geocoding,
ranking, fairness bars, the open-now and price filters, voting, the
share-link round-trip, and straight-line fallback mode. Fails on any
uncaught JS error.

Set `CHROME_PATH` if Playwright's bundled browser isn't installed.

**These mocks prove the app's own logic, not the live APIs.** Nominatim,
Overpass, and OSRM are only exercised for real when the app runs in a
browser with network access.
