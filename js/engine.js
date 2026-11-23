/* Analytics engine — pure logic, no DOM. Used by app.js (browser) and tests/engine.test.js (Node). */
(function (root) {
  "use strict";
  const DAY = 86400000;
  const E_err = (m) => m !== "";
  const Engine = {
    // Local calendar date (YYYY-MM-DD). toISOString() is UTC, which gives "yesterday" in India before 5:30 AM.
    localDate(d) {
      const x = d ? new Date(d) : new Date(), p = (n) => String(n).padStart(2, "0");
      return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
    },
    // ---- Input validation (pure functions so they can be unit-tested) ----
    // Returns an error message, or "" when the thresholds are acceptable.
    validateThresholds(fast, dead, low) {
      if (![fast, dead, low].every(Number.isFinite)) return "Enter a number in every threshold field.";
      if (!Number.isInteger(fast) || !Number.isInteger(dead) || !Number.isInteger(low)) return "Thresholds must be whole numbers.";
      if (fast < 1 || fast > 99) return "The FAST threshold must be between 1 and 99.";
      if (dead < 0 || dead > 98) return "The DEAD threshold must be between 0 and 98.";
      if (low < 0) return "Low-stock alert must be 0 or more.";
      if (dead >= fast) return "The DEAD threshold must be lower than the FAST threshold.";
      return "";
    },
    // A sale must be a whole number of units, at least 1, no more than what is left, and not dated in the future.
    validateSale(qty, left, date, today) {
      if (!Number.isFinite(qty) || qty <= 0) return "Enter at least 1 unit sold.";
      if (!Number.isInteger(qty)) return "Units sold must be a whole number.";
      if (qty > left) return "Only " + left + " unit(s) left in stock for this period.";
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choose a valid date.";
      if (today && date > today) return "Sale date cannot be in the future.";
      return "";
    },
    // Case-insensitive duplicate check on name + category (the CSV import already merges on the same key).
    isDuplicate(products, name, category, exceptId) {
      const n = String(name || "").trim().toLowerCase(), c = String(category || "General").trim().toLowerCase();
      return products.some(p => p.id !== exceptId && p.name.trim().toLowerCase() === n && String(p.category || "General").trim().toLowerCase() === c);
    },
    // Validates a product form (add or edit). Returns { error, product } where product is cleaned up when error is "".
    validateProduct(f, products, exceptId) {
      const name = String(f.name || "").trim(), category = String(f.category || "").trim() || "General";
      const stock = Number(f.stock), cost = Number(f.cost);
      if (!name) return { error: "Enter a product name." };
      if (name.length > 80) return { error: "Product name is too long (80 characters max)." };
      if (String(f.stock).trim() === "") return { error: "Stock is required." };
      if (String(f.cost).trim() === "") return { error: "Cost per unit is required." };
      if (!Number.isFinite(stock) || stock < 0) return { error: "Stock must be 0 or more." };
      if (!Number.isInteger(stock)) return { error: "Stock must be a whole number." };
      if (!Number.isFinite(cost) || cost < 0) return { error: "Cost per unit must be 0 or more." };
      if (this.isDuplicate(products, name, category, exceptId)) return { error: name + " already exists in " + category + "." };
      return { error: "", product: { name, category, stock, cost } };
    },
    // Keeps only the newest `perProduct` snapshots for each product so one busy product cannot push out the rest.
    trimHistory(hist, perProduct) {
      const keep = perProduct || 30, seen = {}, out = [];
      for (let i = hist.length - 1; i >= 0; i--) {
        const k = hist[i].productId; seen[k] = (seen[k] || 0) + 1;
        if (seen[k] <= keep) out.push(hist[i]);
      }
      return out.reverse();
    },
    // Sorts table rows by a column key. Text sorts A-Z, numbers sort low-high; nulls always go last.
    sortRows(rows, key, dir) {
      const m = dir === "desc" ? -1 : 1;
      return rows.slice().sort((a, b) => {
        const x = a[key], y = b[key];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        if (typeof x === "string" || typeof y === "string") return m * String(x).localeCompare(String(y), undefined, { sensitivity: "base" });
        return m * (x - y);
      });
    },
    // Pure CSV import: turns parsed CSV rows into product/sale changes and a list of skipped rows with reasons.
    // `products` is the shop's existing list (not modified); `idGen` creates ids, `today` is YYYY-MM-DD.
    importRows(grid, products, idGen, today) {
      const head = (grid[0] || []).map(h => String(h).trim().toLowerCase()), ix = (n) => head.indexOf(n);
      const need = ["name", "category", "stock", "cost"].filter(n => ix(n) < 0);
      if (need.length) return { error: "CSV is missing column(s): " + need.join(", ") + ".", products, sales: [], added: 0, updated: 0, skipped: [] };
      const out = products.map(p => Object.assign({}, p)), sales = [], skipped = []; let added = 0, updated = 0;
      const toNum = (v) => (v == null || String(v).trim() === "") ? NaN : Number(v);
      grid.slice(1).forEach((r, i) => {
        const line = i + 2, why = (m) => skipped.push({ line, reason: m });
        const name = String(r[ix("name")] || "").trim().replace(/^'(?=[=+\-@])/, ""), category = String(r[ix("category")] || "").trim() || "General";
        const stock = toNum(r[ix("stock")]), cost = toNum(r[ix("cost")]);
        const sold = ix("sold") < 0 ? 0 : (String(r[ix("sold")] || "").trim() === "" ? 0 : toNum(r[ix("sold")]));
        if (!name) return why("name is empty");
        if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) return why("stock must be a whole number, 0 or more");
        if (!Number.isFinite(cost) || cost < 0) return why("cost must be a number, 0 or more");
        if (!Number.isFinite(sold) || sold < 0 || !Number.isInteger(sold)) return why("sold must be a whole number, 0 or more");
        if (sold > stock) return why("sold is more than stock");
        let p = out.find(x => x.name.trim().toLowerCase() === name.toLowerCase() && String(x.category || "General").trim().toLowerCase() === category.toLowerCase());
        if (p) { p.stock = stock; p.cost = cost; updated++; }
        else { p = { id: idGen(), name, category, stock, cost, added: today }; out.push(p); added++; }
        if (sold > 0) sales.push({ id: idGen(), productId: p.id, qty: sold, date: today });
      });
      return { error: "", products: out, sales, added, updated, skipped };
    },
    // Validates a backup file before it replaces the shop's data. Returns an error message or "".
    validateBackup(d) {
      if (!d || d.app !== "smart-dead-stock-detector") return "That file is not a valid backup.";
      if (!Array.isArray(d.products) || !Array.isArray(d.sales)) return "Backup is missing products or sales.";
      const okP = (p) => p && typeof p.id === "string" && typeof p.name === "string" && Number.isFinite(Number(p.stock)) && Number.isFinite(Number(p.cost)) && Number(p.stock) >= 0 && Number(p.cost) >= 0;
      const okS = (s) => s && typeof s.productId === "string" && Number.isFinite(Number(s.qty)) && Number(s.qty) >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(String(s.date));
      if (!d.products.every(okP)) return "Backup contains an invalid product record.";
      const ids = new Set(d.products.map(p => p.id));
      if (!d.sales.every(s => okS(s) && ids.has(s.productId))) return "Backup contains an invalid or orphaned sales record.";
      if (d.settings) {
        const s = d.settings;
        if (E_err(this.validateThresholds(Number(s.fast), Number(s.dead), Number(s.lowStock)))) return "Backup contains invalid threshold settings.";
      }
      return "";
    },
    soldInPeriod(productId, sales, days, now) {
      const cutoff = new Date(now || Date.now()); cutoff.setDate(cutoff.getDate() - days);
      return sales.filter(s => s.productId === productId && new Date(s.date) >= cutoff)
                  .reduce((sum, s) => sum + Number(s.qty), 0);
    },
    daysSinceLastSale(productId, sales, now) {
      const mine = sales.filter(s => s.productId === productId);
      if (!mine.length) return 999;
      const latest = Math.max(...mine.map(s => new Date(s.date).getTime()));
      return Math.max(0, Math.round(((now || Date.now()) - latest) / DAY));
    },
    // STR is capped at 100%: you cannot sell more than the stock you opened with.
    str(stock, sold) { return stock <= 0 ? 0 : Math.min(100, (sold / stock) * 100); },
    lockedCapital(stock, sold, cost) { return Math.max(stock - sold, 0) * cost; },
    // Days of Cover: how long the remaining stock lasts at the current sales rate (null = no sales, can't tell).
    daysOfCover(left, sold, days) {
      if (left <= 0) return 0;
      if (sold <= 0) return null;
      return Math.round(left / (sold / days));
    },
    // Risk score 0-100 = 60% slowness (100 - STR) + 40% staleness (days since last sale, 1.1 pts/day, max 100).
    riskScore(str, daysSince) {
      const slow = Math.max(0, 100 - str), stale = Math.min(100, daysSince * 1.1);
      return Math.round(Math.min(100, slow * 0.6 + stale * 0.4));
    },
    // A product younger than the tracking window with no sales yet gets the benefit of the doubt (not DEAD).
    isNew(product, days, now) {
      if (!product.added) return false;
      return Math.floor(((now || Date.now()) - new Date(product.added).getTime()) / DAY) < days;
    },
    status(sold, str, t, isNew, stock) {
      if (stock === 0) return "SLOW"; // nothing on the shelf, so nothing is "dead" - it just needs restocking or removal
      if (isNew && sold === 0) return "SLOW";
      if (sold === 0 || str < t.dead) return "DEAD";
      return str >= t.fast ? "FAST" : "SLOW";
    },
    thresholdsFor(category, t) {
      const o = (t.cats || {})[String(category || "").trim().toLowerCase()];
      return o ? Object.assign({}, t, { fast: o.fast, dead: o.dead }) : t;
    },
    // Recommended next step for the shop owner.
    action(r, t) {
      if (r.stock === 0) return "No stock on hand \u2013 restock or remove";
      if (r.isNew && r.sold === 0) return "New item \u2013 review after " + "the tracking period";
      if (r.left <= t.lowStock && r.status !== "DEAD") return r.left === 0 ? "Out of stock \u2013 reorder now" : "Reorder now";
      if (r.status === "DEAD") return r.locked > 0 ? "Stop buying \u2013 discount 20-30% to clear" : "Stop buying";
      if (r.status === "SLOW") return r.risk >= 60 ? "Discount 10-15%, hold reorders" : "Monitor sales";
      return "Keep stocked";
    },
    // ABC (Pareto) on locked capital: A = top ~70% of value, B = next ~20%, C = the rest.
    abc(rows) {
      const total = rows.reduce((a, r) => a + r.locked, 0); let cum = 0;
      rows.slice().sort((a, b) => b.locked - a.locked).forEach(r => {
        const before = total > 0 ? (cum / total) * 100 : 100;
        r.abc = r.locked <= 0 ? "C" : before < 70 ? "A" : before < 90 ? "B" : "C"; cum += r.locked;
      });
      return rows;
    },
    parseCsv(text) {
      const rows = []; let row = [], f = "", q = false;
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
        else if (c === '"') q = true;
        else if (c === ",") { row.push(f); f = ""; }
        else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
        else f += c;
      }
      if (f !== "" || row.length) { row.push(f); rows.push(row); }
      return rows.filter(r => r.some(x => x.trim() !== ""));
    },
    enrich(products, sales, days, t, now) {
      const out = products.map(p => {
        const sold = this.soldInPeriod(p.id, sales, days, now);
        const tt = this.thresholdsFor(p.category, t), str = this.str(p.stock, sold);
        const left = Math.max(p.stock - sold, 0);
        const isNew = this.isNew(p, days, now);
        const daysSince = this.daysSinceLastSale(p.id, sales, now);
        return Object.assign({}, p, {
          sold, sold30: this.soldInPeriod(p.id, sales, 30, now), str, left, isNew, daysSince,
          locked: this.lockedCapital(p.stock, sold, p.cost),
          cover: this.daysOfCover(left, sold, days),
          risk: p.stock === 0 ? 0 : this.riskScore(str, daysSince),
          status: this.status(sold, str, tt, isNew, p.stock),
          low: left <= t.lowStock
        });
      });
      this.abc(out); out.forEach(r => { r.action = this.action(r, t); });
      return out;
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Engine; else root.SDDEngine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
