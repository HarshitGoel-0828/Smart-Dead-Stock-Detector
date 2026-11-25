// Run: npm test   (or: node --test)
const test = require("node:test"), assert = require("node:assert");
const E = require("../js/engine.js"), T = { fast: 40, dead: 5, lowStock: 5 };
test("TC01 locked capital", () => assert.equal(E.lockedCapital(40, 3, 80), 2960));
test("TC02 zero sales is DEAD", () => assert.equal(E.status(0, 0, T, false), "DEAD"));
test("TC03 STR 40% is FAST", () => assert.equal(E.status(4, E.str(10, 4), T), "FAST"));
test("TC04 STR 5% is SLOW", () => assert.equal(E.status(1, E.str(20, 1), T), "SLOW"));
test("TC05 STR 4.9% is DEAD", () => assert.equal(E.status(1, 4.9, T), "DEAD"));
test("STR example 3/40 = 7.5", () => assert.equal(E.str(40, 3), 7.5));
test("STR capped at 100", () => assert.equal(E.str(10, 25), 100));
test("new product with no sales is not DEAD", () => assert.equal(E.status(0, 0, T, true), "SLOW"));
test("isNew uses date added", () => {
  const now = Date.parse("2026-11-21");
  assert.equal(E.isNew({ added: "2026-11-15" }, 30, now), true);
  assert.equal(E.isNew({ added: "2026-08-01" }, 30, now), false);
});
test("days of cover", () => {
  assert.equal(E.daysOfCover(37, 3, 30), 370);
  assert.equal(E.daysOfCover(10, 0, 30), null);
  assert.equal(E.daysOfCover(0, 5, 30), 0);
});
test("risk score stays within 0-100", () => {
  assert.equal(E.riskScore(0, 999), 100);
  assert.equal(E.riskScore(100, 0), 0);
});
test("category thresholds override defaults", () => {
  const t = { fast: 40, dead: 5, lowStock: 5, cats: { groceries: { fast: 60, dead: 10 } } };
  assert.equal(E.thresholdsFor("Groceries", t).fast, 60);
  assert.equal(E.thresholdsFor("Home", t).fast, 40);
});
test("ABC: top item is A, zero-locked is C", () => {
  const r = E.abc([{ locked: 7000 }, { locked: 2000 }, { locked: 1000 }, { locked: 0 }]);
  assert.deepEqual(r.map(x => x.abc), ["A", "B", "C", "C"]);
});
test("actions", () => {
  const t = { lowStock: 5 };
  assert.match(E.action({ status: "DEAD", locked: 500, left: 20, sold: 0 }, t), /Stop buying/);
  assert.match(E.action({ status: "FAST", locked: 0, left: 2, sold: 9 }, t), /Reorder/);
  assert.equal(E.action({ status: "FAST", locked: 90, left: 20, sold: 9 }, t), "Keep stocked");
});
test("CSV parser handles quotes, commas, CRLF, blank lines", () => {
  const g = E.parseCsv('name,category\r\n"Cable, USB",Acc\r\n\r\n"He said ""hi""",X');
  assert.deepEqual(g, [["name", "category"], ["Cable, USB", "Acc"], ['He said "hi"', "X"]]);
});
test("localDate gives the local calendar day, not the UTC day", () => {
  const d = new Date(2026, 10, 23, 1, 30); // 23 Nov 2026, 01:30 local time
  assert.equal(E.localDate(d), "2026-11-23");
});
test("validateThresholds rejects blanks, bad ranges and dead >= fast", () => {
  assert.equal(E.validateThresholds(40, 5, 5), "");
  assert.match(E.validateThresholds(NaN, 5, 5), /number/i);
  assert.match(E.validateThresholds(40, 40, 5), /lower than/);
  assert.match(E.validateThresholds(100, 5, 5), /between 1 and 99/);
  assert.match(E.validateThresholds(40, 5, -1), /0 or more/);
  assert.match(E.validateThresholds(40.5, 5, 5), /whole/);
});
test("validateSale checks quantity, stock left and date", () => {
  assert.equal(E.validateSale(3, 10, "2026-11-20", "2026-11-23"), "");
  assert.match(E.validateSale(0, 10, "2026-11-20", "2026-11-23"), /at least 1/);
  assert.match(E.validateSale(2.5, 10, "2026-11-20", "2026-11-23"), /whole/);
  assert.match(E.validateSale(11, 10, "2026-11-20", "2026-11-23"), /Only 10/);
  assert.match(E.validateSale(1, 10, "2026-11-30", "2026-11-23"), /future/);
  assert.match(E.validateSale(1, 10, "", "2026-11-23"), /valid date/);
});
test("isDuplicate ignores case/spacing and can exclude the product being edited", () => {
  const list = [{ id: "p1", name: "USB Cable", category: "Accessories" }];
  assert.equal(E.isDuplicate(list, " usb cable ", "accessories"), true);
  assert.equal(E.isDuplicate(list, "USB Cable", "Home"), false);
  assert.equal(E.isDuplicate(list, "USB Cable", "Accessories", "p1"), false);
});
test("validateBackup accepts a good file and rejects broken ones", () => {
  const good = { app: "smart-dead-stock-detector", products: [{ id: "p1", name: "A", stock: 5, cost: 10 }], sales: [{ productId: "p1", qty: 2, date: "2026-11-20" }], settings: { fast: 40, dead: 5, lowStock: 5 } };
  assert.equal(E.validateBackup(good), "");
  assert.match(E.validateBackup(null), /not a valid backup/);
  assert.match(E.validateBackup({ ...good, products: [{ id: "p1", name: "A", stock: -1, cost: 10 }] }), /invalid product/);
  assert.match(E.validateBackup({ ...good, sales: [{ productId: "zzz", qty: 1, date: "2026-11-20" }] }), /orphaned/);
  assert.match(E.validateBackup({ ...good, settings: { fast: 5, dead: 40, lowStock: 5 } }), /threshold/);
});
test("enrich: end-to-end classification of a small shop", () => {
  const now = Date.parse("2026-11-23T12:00:00");
  const products = [
    { id: "a", name: "Mouse", category: "Electronics", stock: 25, cost: 80, added: "2026-01-01" },
    { id: "b", name: "USB Cable", category: "Accessories", stock: 40, cost: 80, added: "2026-01-01" },
    { id: "c", name: "Old Keyboard", category: "Electronics", stock: 15, cost: 300, added: "2026-01-01" }
  ];
  const sales = [{ productId: "a", qty: 22, date: "2026-11-20" }, { productId: "b", qty: 3, date: "2026-11-10" }];
  const r = E.enrich(products, sales, 30, { fast: 40, dead: 5, lowStock: 5 }, now);
  assert.deepEqual(r.map(x => x.status), ["FAST", "SLOW", "DEAD"]);
  assert.equal(r[1].locked, 2960);       // (40 - 3) x 80
  assert.equal(r[2].locked, 4500);       // 15 x 300, nothing sold
  assert.equal(r[0].left, 3);
  assert.match(r[0].action, /Reorder/);  // 3 left <= low-stock level of 5
});
test("status boundaries: exactly 5% is SLOW, exactly 40% is FAST", () => {
  const t = { fast: 40, dead: 5 };
  assert.equal(E.status(1, E.str(20, 1), t, false), "SLOW");
  assert.equal(E.status(2, E.str(5, 2), t, false), "FAST");
  assert.equal(E.status(0, 0, t, false), "DEAD");
});
test("per-category thresholds change the status", () => {
  const t = { fast: 40, dead: 5, lowStock: 1, cats: { groceries: { fast: 60, dead: 10 } } };
  const p = [{ id: "g", name: "Rice", category: "Groceries", stock: 100, cost: 50, added: "2026-01-01" }];
  const r = E.enrich(p, [{ productId: "g", qty: 50, date: "2026-11-20" }], 30, t, Date.parse("2026-11-23"));
  assert.equal(r[0].status, "SLOW"); // 50% is FAST under the default, but groceries need 60%
});
test("ABC with no stock value puts everything in class C", () => {
  assert.deepEqual(E.abc([{ locked: 0 }, { locked: 0 }]).map(x => x.abc), ["C", "C"]);
});
test("CSV parser handles a UTF-8 BOM-free header and a trailing newline", () => {
  assert.deepEqual(E.parseCsv("a,b\n1,2\n"), [["a", "b"], ["1", "2"]]);
});
test("a product with zero stock is not flagged as dead stock", () => {
  const T = { fast: 40, dead: 5, lowStock: 5 };
  const r = E.enrich([{ id: "z", name: "Empty", category: "c", stock: 0, cost: 50, added: "2026-01-01" }], [], 30, T, Date.parse("2026-11-23"));
  assert.equal(r[0].status, "SLOW");
  assert.equal(r[0].risk, 0);
  assert.equal(r[0].locked, 0);
  assert.match(r[0].action, /No stock on hand/);
});
test("validateProduct cleans input and rejects bad values", () => {
  const list = [{ id: "p1", name: "USB Cable", category: "Accessories" }];
  const ok = E.validateProduct({ name: "  Lamp ", category: "", stock: "12", cost: "450" }, list);
  assert.deepEqual(ok, { error: "", product: { name: "Lamp", category: "General", stock: 12, cost: 450 } });
  assert.match(E.validateProduct({ name: "", category: "", stock: 1, cost: 1 }, list).error, /name/);
  assert.match(E.validateProduct({ name: "A", category: "", stock: "", cost: 1 }, list).error, /Stock/ ) ;
  assert.match(E.validateProduct({ name: "A", category: "", stock: 1.5, cost: 1 }, list).error, /whole/);
  assert.match(E.validateProduct({ name: "A", category: "", stock: 1, cost: -1 }, list).error, /Cost/);
  assert.match(E.validateProduct({ name: "usb cable", category: "accessories", stock: 1, cost: 1 }, list).error, /already exists/);
  assert.equal(E.validateProduct({ name: "usb cable", category: "accessories", stock: 1, cost: 1 }, list, "p1").error, "");
});
test("trimHistory keeps the newest N snapshots per product and preserves order", () => {
  const h = [{ productId: "a", ts: 1 }, { productId: "a", ts: 2 }, { productId: "b", ts: 3 }, { productId: "a", ts: 4 }];
  assert.deepEqual(E.trimHistory(h, 2).map(x => x.ts), [2, 3, 4]);
  assert.equal(E.trimHistory(h, 10).length, 4);
});
test("sortRows sorts text and numbers, with nulls last", () => {
  const rows = [{ n: "b", v: 5 }, { n: "A", v: null }, { n: "c", v: 1 }];
  assert.deepEqual(E.sortRows(rows, "n", "asc").map(x => x.n), ["A", "b", "c"]);
  assert.deepEqual(E.sortRows(rows, "v", "asc").map(x => x.v), [1, 5, null]);
  assert.deepEqual(E.sortRows(rows, "v", "desc").map(x => x.v), [5, 1, null]);
});
test("importRows adds, updates and reports skipped rows with reasons", () => {
  let n = 0; const id = () => "id" + (++n);
  const existing = [{ id: "p1", name: "Notebook", category: "Stationery", stock: 10, cost: 5, added: "2026-01-01" }];
  const grid = E.parseCsv("name,category,stock,cost,sold\nnotebook,stationery,50,6,4\nPen,Stationery,20,3,0\n,Stationery,5,5,0\nBad,Home,abc,5,0\nOver,Home,5,5,9");
  const r = E.importRows(grid, existing, id, "2026-11-23");
  assert.equal(r.error, "");
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.deepEqual(r.skipped.map(s => s.line), [4, 5, 6]);
  assert.match(r.skipped[0].reason, /name is empty/);
  assert.match(r.skipped[2].reason, /more than stock/);
  assert.equal(r.products.find(p => p.id === "p1").stock, 50);
  assert.equal(r.sales.length, 1);
  assert.equal(existing[0].stock, 10); // the input list is not mutated
});
test("importRows reports missing columns", () => {
  const r = E.importRows(E.parseCsv("name,stock\nA,1"), [], () => "x", "2026-11-23");
  assert.match(r.error, /category, cost/);
});
test("suggestDiscount deepens with time unsold and never applies to fast or empty items", () => {
  assert.equal(E.suggestDiscount({ stock: 10, locked: 500, status: "DEAD", daysSince: 20, risk: 90 }), 25);
  assert.equal(E.suggestDiscount({ stock: 10, locked: 500, status: "DEAD", daysSince: 60, risk: 90 }), 30);
  assert.equal(E.suggestDiscount({ stock: 10, locked: 500, status: "DEAD", daysSince: 999, risk: 100 }), 35);
  assert.equal(E.suggestDiscount({ stock: 10, locked: 500, status: "SLOW", daysSince: 30, risk: 72 }), 15);
  assert.equal(E.suggestDiscount({ stock: 10, locked: 500, status: "SLOW", daysSince: 30, risk: 55 }), 10);
  assert.equal(E.suggestDiscount({ stock: 10, locked: 500, status: "SLOW", daysSince: 5, risk: 30 }), 0);
  assert.equal(E.suggestDiscount({ stock: 10, locked: 500, status: "FAST", daysSince: 1, risk: 5 }), 0);
  assert.equal(E.suggestDiscount({ stock: 0, locked: 0, status: "SLOW", daysSince: 999, risk: 0 }), 0);
});
test("recommended action mentions the suggested discount", () => {
  const T = { fast: 40, dead: 5, lowStock: 1 };
  const now = Date.parse("2026-11-23");
  const p = [{ id: "k", name: "Old Keyboard", category: "Electronics", stock: 15, cost: 300, added: "2026-01-01" }];
  const r = E.enrich(p, [], 30, T, now);
  assert.equal(r[0].status, "DEAD");
  assert.match(r[0].action, /discount ~35%/);
});
