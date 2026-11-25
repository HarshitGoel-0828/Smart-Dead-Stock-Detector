# Changelog

## 1.3.0
- Activity log: the server records product, sale and settings changes, logins and password changes in MySQL; the History page shows them.
- Change password from Settings (checks the current password and logs out other devices).
- Sample data now saves correctly to the server; save errors are shown once instead of repeatedly.

## 1.2.0
- The recommended action now includes a suggested clearance discount: 25-35% for dead stock (more the longer it has gone unsold) and 10-15% for slow items at higher risk.
- Backend: Java server with MySQL storage, server-side login and a validated data API; the app now saves to MySQL instead of the browser.

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
