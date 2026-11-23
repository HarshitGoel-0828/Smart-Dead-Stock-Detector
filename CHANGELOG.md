# Changelog

## 1.1.0
### Fixed
- "Today" now uses the local date; before, sales entered before 5:30 AM in India were dated yesterday.
- Blank threshold fields no longer save `NaN`; thresholds are validated (whole numbers, DEAD lower than FAST).
- Products with zero stock are no longer shown as dead stock with a risk of 100.
- Restoring a backup now validates products, sales and settings before replacing any data.
- History keeps the newest 30 snapshots per product instead of one global cap.

### Added
- Sales validation: whole units, at least 1, not above the stock left, no future dates.
- Shared product validation for the add and edit forms (blank, negative, decimal and duplicate checks).
- Click-to-sort columns, a category filter and a print layout on the products page.
- The tracking period is remembered for each shop.
- CSV import reports how many rows were skipped and why.
- Accessibility: skip link, labelled delete buttons, live regions for messages.
- Unit tests grew from 15 to 31; GitHub Actions runs them on every push.

## 1.0.0
- First version: dashboard, classification, locked capital, risk score, alerts, CSV import/export, backup/restore.
