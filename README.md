# Smart Dead Stock Detector

Inventory intelligence for small shops. It classifies every product as **Fast moving**, **Slow moving**
or **Dead stock**, shows how much money is locked in unsold stock, recommends an action for each
product and raises reorder alerts.

BCA project - Microtek College of Management and Technology, Varanasi (VBSPU).

## Features
- Register / log in per shop (passwords hashed with PBKDF2 + salt; data kept separate for each shop)
- Product management: add, edit, categories, duplicate protection, sortable columns, category filter
- Record sales with validation (whole units, not above stock, no future dates)
- Dashboard: status counts, locked capital, risk ranking, bar / donut / trend charts
- Suggested clearance discount for slow and dead items (deeper the longer an item sits unsold)
- Reorder alerts with a bell menu and a downloadable reorder list
- Classification history snapshots
- Per-category thresholds, tracking period of 30 / 60 / 90 days
- CSV import (skipped rows are reported with reasons), CSV report export, print layout, JSON backup and restore (validated before restoring)
- Responsive layout down to phone screens; keyboard-friendly with a skip link and labelled controls
- Remembers the selected tracking period for each shop

## Run
Open `index.html` in a browser - there is no build step. Register a shop account, then use
**Settings -> Load sample data** for a quick demo, or **Import CSV** on the Products page
(see `sample-import.csv` for the format).

## Test
Requires Node.js 18 or newer:

```
npm test
```

The analytics engine (`js/engine.js`) is pure logic with no DOM access, so every formula,
threshold boundary and validation rule is covered by unit tests in `tests/engine.test.js`.

## Project structure
| Path | Purpose |
| --- | --- |
| `index.html` | Layout and views |
| `css/style.css` | Styles |
| `js/engine.js` | Analytics engine and validation rules (unit-tested) |
| `js/app.js` | Login, storage, charts, alerts, import / export / backup |
| `tests/engine.test.js` | Unit tests |
| `.github/workflows/test.yml` | Runs the tests on every push |

## Metrics
- **Sell-Through Rate (STR)** = units sold / stock x 100 (capped at 100%)
- **Locked Capital** = (stock - units sold) x cost per unit
- **Days of Cover** = units left / average daily sales
- **Risk Score (0-100)** = 60% slowness (100 - STR) + 40% staleness (1.1 points per day since last sale, max 100)
- **Status**: SLOW if the product has zero stock (nothing is locked, so it is not dead); otherwise DEAD if there are no sales or STR is below the dead threshold; FAST if STR is at or above the
  fast threshold; otherwise SLOW. New products (younger than the tracking period, no sales yet) are not marked DEAD.
- **ABC class** by locked capital: A = top ~70% of value, B = next ~20%, C = the rest
- Defaults: FAST >= 40%, DEAD < 5%, low-stock alert at 5 units; thresholds can be overridden per category.

## Limitations
- Data is stored in the browser (`localStorage`), so it stays on one device - use **Download backup** regularly.
- Login is a prototype convenience, not server-grade security.
- Sales are entered manually; there is no billing or barcode integration.
