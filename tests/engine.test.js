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
