# Smart Dead Stock Detector

Inventory intelligence for small shops: classifies every product as Fast moving, Slow moving or Dead stock,
shows the capital locked in unsold stock, recommends an action per product, and raises reorder alerts.

## Run
Open `index.html` in a browser (no build step). Register a shop account, then use
Settings -> "Load sample data" for a quick demo, or "Import CSV" on the Products page (see `sample-import.csv`).

## Structure
- `index.html` - layout and views
- `css/style.css` - styles (responsive down to phones)
- `js/engine.js` - analytics engine (pure logic, unit-tested)
- `js/app.js` - auth, storage, charts, alerts, import/backup
- `tests/engine.test.js` - unit tests (`node --test tests/engine.test.js`)

## Metrics
- Sell-Through Rate = units sold / stock x 100 (capped at 100%)
- Locked Capital = (stock - units sold) x cost per unit
- Days of Cover = units left / average daily sales
- Risk Score (0-100) = 60% slowness (100 - STR) + 40% staleness (1.1 points per day since last sale)
- Status: DEAD if no sales or STR < dead threshold; FAST if STR >= fast threshold; else SLOW.
  New products (younger than the tracking period, no sales yet) are not marked DEAD.
- ABC class by locked capital: A = top ~70% of value, B = next ~20%, C = rest
- Thresholds can be overridden per category in Settings.

## Notes
Data is stored in the browser (`localStorage`); use Settings -> Download backup regularly.
Login here is a prototype convenience, not server-grade security.
