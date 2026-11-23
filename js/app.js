/* ==========================================================
   Smart Dead Stock Detector — client-side prototype
   Implements every functional requirement from the SRS (§2.3)
   that can reasonably run without a server:
     - shop-owner registration & login (salted SHA-256 hashing)
     - add / edit / remove products
     - record units sold, dated, for a tracking period
     - validate input before it reaches the "store"
     - compute STR, Locked Capital, Dead Stock Risk Score
     - classify FAST / SLOW / DEAD on configurable thresholds
     - dashboard summary cards + bar chart + donut chart
     - CSV export
     - classification history log
   Data lives in localStorage, namespaced per shop-owner so one
   owner never sees another's ledger (SRS §4.2). Swap the Store
   module for real API calls once the Java + MySQL backend
   (SRS §6.5) exists — nothing else in this file needs to change.
   ========================================================== */

(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const todayISO = () => Engine.localDate();
  const uid = (p) => (p || "id") + crypto.randomUUID().slice(0, 8);
  const rupee = (n) => Math.round(n).toLocaleString("en-IN");
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  /* ============================================================
     AUTH — registration & login with salted SHA-256 hashing
     via the browser's native Web Crypto API. (A real deployment
     must still perform this hashing server-side — see SRS §2.3
     and the note on the Settings view.)
     ============================================================ */
  const Auth = {
    usersKey: "sdd_users_v1",
    sessionKey: "sdd_session_v1",

    allUsers(){
      try{ return JSON.parse(localStorage.getItem(this.usersKey)) || []; }catch(e){ return []; }
    },
    saveUsers(list){ localStorage.setItem(this.usersKey, JSON.stringify(list)); },

    async hash(password, saltHex, legacy){
      const enc = new TextEncoder(), hex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
      if (legacy) return hex(await crypto.subtle.digest("SHA-256", enc.encode(saltHex + ":" + password)));
      const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
      return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", iterations: 150000, salt: enc.encode(saltHex) }, key, 256));
    },
    randomSalt(){
      const arr = crypto.getRandomValues(new Uint8Array(16));
      return Array.from(arr).map(b => b.toString(16).padStart(2,"0")).join("");
    },

    async register(shop, username, password){
      const users = this.allUsers();
      if (users.some(u => u.username.toLowerCase() === username.toLowerCase())){
        throw new Error("That username is already taken.");
      }
      const salt = this.randomSalt();
      const hash = await this.hash(password, salt);
      users.push({ shop, username, salt, hash, v: 2 });
      this.saveUsers(users);
      this.setSession(username);
      return true;
    },
    async login(username, password){
      const users = this.allUsers();
      const u = users.find(x => x.username.toLowerCase() === username.toLowerCase());
      if (!u) throw new Error("No account with that username.");
      const hash = await this.hash(password, u.salt, !u.v);
      if (hash !== u.hash) throw new Error("Incorrect password.");
      this.setSession(username);
      return true;
    },
    setSession(username){ localStorage.setItem(this.sessionKey, JSON.stringify({ username })); },
    logout(){ localStorage.removeItem(this.sessionKey); },
    currentUsername(){
      try{ return (JSON.parse(localStorage.getItem(this.sessionKey)) || {}).username || null; }catch(e){ return null; }
    },
    currentUser(){
      const uname = this.currentUsername();
      if (!uname) return null;
      return this.allUsers().find(u => u.username === uname) || null;
    },

  };

  /* ============================================================
     STORE — per-shop persistence. Everything is namespaced by
     the logged-in username, mirroring the SRS's one-owner / many
     -products, one-product / many-sales schema (§4.2).
     ============================================================ */
  const Store = {
    ns(){ return Auth.currentUsername() || "anon"; },
    key(name){ return "sdd_" + this.ns() + "_" + name + "_v1"; },

    get(name, fallback){
      try{
        const raw = localStorage.getItem(this.key(name));
        return raw ? JSON.parse(raw) : fallback;
      }catch(e){ return fallback; }
    },
    set(name, value){
      try{ localStorage.setItem(this.key(name), JSON.stringify(value)); }catch(e){ /* storage unavailable */ }
    },

    products(){ return this.get("products", []); },
    saveProducts(list){ this.set("products", list); },
    sales(){ return this.get("sales", []); },
    saveSales(list){ this.set("sales", list); },
    history(){ return this.get("history", []); },
    saveHistory(list){ this.set("history", list); },
    settings(){ return Object.assign({ fast: 40, dead: 5, lowStock: 5, cats: {} }, this.get("settings", {})); },
    saveSettings(s){ this.set("settings", s); },

    seedIfEmpty(){
      if (this.products().length) return;
      const today = new Date();
      const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return Engine.localDate(d); };

      const products = [
        { id: uid("p"), name: "Wireless Mouse",    category: "Electronics", stock: 25, cost: 380 },
        { id: uid("p"), name: "USB Cable",         category: "Accessories", stock: 40, cost: 80  },
        { id: uid("p"), name: "Old Keyboard",      category: "Electronics", stock: 15, cost: 300 },
        { id: uid("p"), name: "Bluetooth Speaker", category: "Audio",       stock: 10, cost: 900 },
        { id: uid("p"), name: "Phone Charger",     category: "Accessories", stock: 30, cost: 150 },
        { id: uid("p"), name: "Table Lamp",        category: "Home",       stock: 12, cost: 450 },
      ];
      this.saveProducts(products);

      const sales = [];
      const addSale = (pIdx, qty, daysAgoN) => sales.push({ id: uid("s"), productId: products[pIdx].id, qty, date: daysAgo(daysAgoN) });
      // Wireless Mouse — fast mover, recent & frequent sales
      addSale(0, 9, 2); addSale(0, 7, 9); addSale(0, 6, 18);
      // USB Cable — slow, sparse
      addSale(1, 2, 21); addSale(1, 1, 45);
      // Old Keyboard — dead, nothing recent at all
      // (no sales records — zero units sold)
      // Bluetooth Speaker — fast
      addSale(3, 5, 1); addSale(3, 4, 12);
      // Phone Charger — slow
      addSale(4, 2, 14); addSale(4, 2, 50);
      // Table Lamp — slow/near-dead
      addSale(5, 1, 60);

      this.saveSales(sales);
      this.saveHistory([]);
      this.saveSettings({ fast: 40, dead: 5, lowStock: 5 });
    }
  };

  /* ============================================================
     ANALYTICS ENGINE — mirrors SRS §6.3–6.4 exactly.
     ============================================================ */
  const Engine = window.SDDEngine;

  /* ============================================================
     APP STATE
     ============================================================ */
  let activeFilter = "ALL";
  let searchTerm = "";
  let prevAlerts = null;

  function trackingDays(){
    return parseInt($("#trackingPeriod").value, 10) || 30;
  }
  function rows(){
    return Engine.enrich(Store.products(), Store.sales(), trackingDays(), Store.settings());
  }

  /* ============================================================
     RENDER: dashboard summary + charts
     ============================================================ */
  function renderSummary(data){
    const groups = {
      FAST: { units: 0, value: 0, count: 0 },
      SLOW: { units: 0, value: 0, count: 0 },
      DEAD: { units: 0, value: 0, count: 0 },
    };
    data.forEach(r => {
      const g = groups[r.status];
      g.units += r.left; g.value += r.locked; g.count += 1;
    });
    const totalValue = groups.FAST.value + groups.SLOW.value + groups.DEAD.value;

    Object.keys(groups).forEach(k => {
      const g = groups[k];
      const S = k.charAt(0) + k.slice(1).toLowerCase();
      const pct = totalValue > 0 ? Math.round((g.value / totalValue) * 100) : 0;
      $("#val" + S).textContent = rupee(g.value);
      $("#units" + S).textContent = g.units.toLocaleString("en-IN");
      $("#count" + S).textContent = g.count;
      $("#pct" + S).textContent = pct;
      $("#bar" + S).style.width = pct + "%";
    });
  }

  /* ============================================================
     ALERTS — reorder notifications driven by Settings alert level
     ============================================================ */
  function toast(text, type){
    const box = $("#toasts");
    const t = document.createElement("div");
    t.className = "toast toast--" + (type || "warn");
    const msg = document.createElement("span"); msg.textContent = text;
    const x = document.createElement("button"); x.type = "button"; x.innerHTML = "&times;"; x.setAttribute("aria-label", "Dismiss");
    x.addEventListener("click", () => t.remove());
    t.appendChild(msg); t.appendChild(x); box.appendChild(t);
    setTimeout(() => t.remove(), 8000);
  }

  function renderAlerts(data){
    const lvl = Store.settings().lowStock;
    const low = data.filter(r => r.low).sort((a, b) => a.left - b.left);
    const n = low.length, out = low.filter(r => r.left === 0).length;
    const plural = n === 1 ? "" : "s";

    ["#bellCount", "#navAlertCount"].forEach(sel => { const b = $(sel); b.textContent = n > 99 ? "99+" : n; b.hidden = n === 0; });

    $("#alertBanner").hidden = n === 0;
    if (n){
      $("#alertBannerTitle").textContent = n + " product" + plural + " need" + (n === 1 ? "s" : "") + " to be purchased";
      $("#alertBannerSub").textContent = out ? out + " already out of stock" : "At or below your alert level of " + lvl + " units";
    }

    const urgency = (r) => r.left === 0 ? ["DEAD", "OUT OF STOCK"] : (r.left <= lvl / 2 ? ["DEAD", "CRITICAL"] : ["SLOW", "LOW"]);

    const bl = $("#bellList"); bl.innerHTML = "";
    if (!n) bl.innerHTML = '<li class="bell-empty">All stocked up &mdash; nothing to reorder.</li>';
    low.slice(0, 6).forEach(r => {
      const li = document.createElement("li");
      li.innerHTML = '<span><strong>' + escapeHtml(r.name) + '</strong><small>Needs to be purchased</small></span>' +
        '<span class="bell-left' + (r.left === 0 ? ' is-out' : '') + '">' + (r.left === 0 ? "Out" : r.left + " left") + '</span>';
      bl.appendChild(li);
    });

    $("#alertsNote").textContent = n ? n + " at or below " + lvl + " units" : "alert level: " + lvl + " units";
    const tb = $("#alertsBody"); tb.innerHTML = "";
    if (!n) tb.innerHTML = '<tr><td colspan="7" style="color:var(--muted); padding:24px 12px;">Nothing to purchase right now. Alerts appear here when a product drops to ' + lvl + ' units or fewer.</td></tr>';
    low.forEach(r => {
      const u = urgency(r), tr = document.createElement("tr");
      tr.innerHTML = '<td class="name">' + escapeHtml(r.name) + '</td><td class="cat">' + escapeHtml(r.category) + '</td>' +
        '<td class="num">' + r.sold30 + '</td>' +
        '<td class="num ' + (r.left === 0 ? "is-out" : "is-low") + '">' + r.left + '</td><td class="num">' + lvl + '</td>' +
        '<td class="num">\u20b9' + rupee(r.cost) + '</td><td><span class="tag tag-' + u[0] + '">' + u[1] + '</span></td>';
      tb.appendChild(tr);
    });

    const ids = new Set(low.map(r => r.id));
    if (prevAlerts === null){
      if (n) toast(n + " product" + plural + " need" + (n === 1 ? "s" : "") + " to be purchased. Open Alerts to review.");
    } else {
      const fresh = low.filter(r => !prevAlerts.has(r.id));
      fresh.slice(0, 3).forEach(r => toast("Reorder needed: " + r.name + " \u2014 " + (r.left === 0 ? "out of stock" : "only " + r.left + " left") + "."));
      if (fresh.length > 3) toast((fresh.length - 3) + " more products need to be purchased.");
    }
    prevAlerts = ids;
  }

  /* ============================================================
     CHARTS — responsive SVG with gridlines and hover tooltips
     ============================================================ */
  const NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent){
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function niceScale(max, ticks){
    if (max <= 0) max = 1;
    const raw = max / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    const step = Math.max(1, (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag);
    const n = Math.ceil(max / step);
    return { step, n, max: step * n };
  }
  function fmtC(n){
    if (n >= 1e7) return (n / 1e7).toFixed(1).replace(/\.0$/, "") + "Cr";
    if (n >= 1e5) return (n / 1e5).toFixed(1).replace(/\.0$/, "") + "L";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(Math.round(n));
  }
  function chartSize(svg){
    const W = Math.round(svg.getBoundingClientRect().width) || 600;
    const H = W < 480 ? 240 : 280;
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("height", H);
    return { W, H };
  }
  function emptyChart(svg, W, H, msg){
    const t = svgEl("text", { x: W / 2, y: H / 2, "text-anchor": "middle", class: "bar-label" }, svg);
    t.textContent = msg;
  }

  function renderChart(data){
    const svg = $("#barChart"); svg.innerHTML = "";
    const { W, H } = chartSize(svg);
    const byCat = {};
    data.forEach(r => {
      const c = byCat[r.category] || (byCat[r.category] = { FAST: 0, SLOW: 0, DEAD: 0, total: 0 });
      c[r.status] += r.locked; c.total += r.locked;
    });
    const cats = Object.entries(byCat).sort((a, b) => b[1].total - a[1].total);
    if (!cats.length) return emptyChart(svg, W, H, "No products yet");

    const padL = 46, padR = 8, padT = 16, padB = 32, iw = W - padL - padR, ih = H - padT - padB;
    const sc = niceScale(Math.max(...cats.map(c => c[1].total)), 4);
    for (let i = 0; i <= sc.n; i++){
      const y = padT + ih - (i / sc.n) * ih;
      svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: i ? "grid" : "axis" }, svg);
      svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", class: "bar-label" }, svg).textContent = "\u20b9" + fmtC(i * sc.step);
    }
    const slot = iw / cats.length, bw = Math.min(64, slot * 0.58);
    const names = { FAST: "Fast moving", SLOW: "Slow moving", DEAD: "Dead stock" };
    const maxChars = Math.max(4, Math.floor(slot / 7));
    cats.forEach(([name, c], i) => {
      const x = padL + slot * i + (slot - bw) / 2;
      let y = padT + ih;
      ["DEAD", "SLOW", "FAST"].forEach(k => {
        if (c[k] <= 0) return;
        const h = (c[k] / sc.max) * ih; y -= h;
        const r = svgEl("rect", { x, y, width: bw, height: Math.max(h, 1), class: "seg seg-" + k }, svg);
        r.setAttribute("data-tip", "<strong>" + escapeHtml(name) + "</strong><br>" + names[k] + ": \u20b9" + rupee(c[k]));
      });
      svgEl("text", { x: x + bw / 2, y: y - 6, "text-anchor": "middle", class: "bar-value" }, svg).textContent = "\u20b9" + fmtC(c.total);
      svgEl("text", { x: x + bw / 2, y: padT + ih + 18, "text-anchor": "middle", class: "bar-label" }, svg).textContent =
        name.length > maxChars ? name.slice(0, maxChars - 1) + "\u2026" : name;
    });
  }

  function renderDonut(data){
    const svg = $("#donutChart"), legend = $("#donutLegend");
    svg.innerHTML = ""; legend.innerHTML = "";
    const counts = { FAST: 0, SLOW: 0, DEAD: 0 };
    data.forEach(r => counts[r.status]++);
    const total = data.length, R = 58, C = 2 * Math.PI * R, names = { FAST: "Fast", SLOW: "Slow", DEAD: "Dead" };
    svgEl("circle", { cx: 80, cy: 80, r: R, fill: "none", class: "donut-track", "stroke-width": 20 }, svg);
    let offset = 0;
    Object.keys(counts).forEach(k => {
      const n = counts[k], frac = total ? n / total : 0, pct = Math.round(frac * 100);
      if (n){
        const dash = Math.max(frac * C - (total > n ? 3 : 0), 0.5);
        const c = svgEl("circle", {
          cx: 80, cy: 80, r: R, fill: "none", class: "donut-seg donut-" + k, "stroke-width": 20,
          "stroke-dasharray": dash + " " + (C - dash), "stroke-dashoffset": -offset, transform: "rotate(-90 80 80)"
        }, svg);
        c.setAttribute("data-tip", "<strong>" + names[k] + "</strong><br>" + n + " product" + (n === 1 ? "" : "s") + " &middot; " + pct + "%");
      }
      offset += frac * C;
      const li = document.createElement("li");
      li.innerHTML = '<span class="dot dot-' + k.toLowerCase() + '"></span><span class="lg-name">' + names[k] +
        '</span><strong>' + n + '</strong><span class="lg-pct">' + pct + '%</span>';
      legend.appendChild(li);
    });
    svgEl("text", { x: 80, y: 82, "text-anchor": "middle", class: "donut-total" }, svg).textContent = total;
    svgEl("text", { x: 80, y: 98, "text-anchor": "middle", class: "donut-sub" }, svg).textContent = "PRODUCTS";
  }

  function renderTrend(){
    const svg = $("#trendChart"); svg.innerHTML = "";
    const { W, H } = chartSize(svg);
    const days = trackingDays(), step = days <= 30 ? 1 : 7, nb = Math.ceil(days / step);
    const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - (nb * step - 1));
    const buckets = Array.from({ length: nb }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i * step); return { d, v: 0 }; });
    Store.sales().forEach(sl => {
      const idx = Math.floor((new Date(sl.date + "T00:00:00") - start) / (86400000 * step));
      if (idx >= 0 && idx < nb) buckets[idx].v += Number(sl.qty);
    });
    const total = buckets.reduce((a, b) => a + b.v, 0);
    $("#trendNote").textContent = total + " unit" + (total === 1 ? "" : "s") + " sold \u00b7 last " + days + " days";
    if (!total) return emptyChart(svg, W, H, "No sales recorded in this period");

    const padL = 40, padR = 14, padT = 14, padB = 30, iw = W - padL - padR, ih = H - padT - padB;
    const sc = niceScale(Math.max(...buckets.map(b => b.v)), 4);
    const fd = (d) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    for (let i = 0; i <= sc.n; i++){
      const y = padT + ih - (i / sc.n) * ih;
      svgEl("line", { x1: padL, x2: W - padR, y1: y, y2: y, class: i ? "grid" : "axis" }, svg);
      svgEl("text", { x: padL - 8, y: y + 4, "text-anchor": "end", class: "bar-label" }, svg).textContent = i * sc.step;
    }
    const defs = svgEl("defs", {}, svg), g = svgEl("linearGradient", { id: "trendGrad", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    svgEl("stop", { offset: "0%", style: "stop-color:var(--accent);stop-opacity:.38" }, g);
    svgEl("stop", { offset: "100%", style: "stop-color:var(--accent);stop-opacity:0" }, g);
    const px = (i) => padL + (nb > 1 ? (i / (nb - 1)) * iw : iw / 2);
    const py = (v) => padT + ih - (v / sc.max) * ih;
    const line = buckets.map((b, i) => (i ? "L" : "M") + px(i).toFixed(1) + "," + py(b.v).toFixed(1)).join("");
    svgEl("path", { d: line + "L" + px(nb - 1).toFixed(1) + "," + (padT + ih) + "L" + px(0).toFixed(1) + "," + (padT + ih) + "Z", fill: "url(#trendGrad)" }, svg);
    svgEl("path", { d: line, class: "trend-line", fill: "none" }, svg);
    const every = Math.ceil(nb / (W < 480 ? 4 : 7));
    buckets.forEach((b, i) => {
      if (i % every === 0 || i === nb - 1)
        svgEl("text", { x: px(i), y: padT + ih + 18, "text-anchor": i === 0 ? "start" : (i === nb - 1 ? "end" : "middle"), class: "bar-label" }, svg).textContent = fd(b.d);
      if (b.v > 0) svgEl("circle", { cx: px(i), cy: py(b.v), r: 3.5, class: "trend-dot" }, svg);
      const end = new Date(b.d); end.setDate(end.getDate() + step - 1);
      const hit = svgEl("circle", { cx: px(i), cy: py(b.v), r: 11, fill: "transparent" }, svg);
      hit.setAttribute("data-tip", "<strong>" + (step > 1 ? fd(b.d) + " \u2013 " + fd(end) : fd(b.d)) + "</strong><br>" + b.v + " unit" + (b.v === 1 ? "" : "s") + " sold");
    });
  }

  /* tooltip (mouse + touch) */
  const tip = $("#chartTip");
  function moveTip(e){
    const el = e.target.closest && e.target.closest("[data-tip]");
    if (!el){ tip.hidden = true; return; }
    tip.innerHTML = el.getAttribute("data-tip"); tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let top = e.clientY - r.height - 14; if (top < 8) top = e.clientY + 18;
    tip.style.left = Math.max(8, Math.min(e.clientX + 14, window.innerWidth - r.width - 8)) + "px";
    tip.style.top = top + "px";
  }
  document.addEventListener("pointermove", moveTip);
  document.addEventListener("pointerdown", moveTip);

  function renderRisk(data){
    const list = $("#riskList");
    list.innerHTML = "";
    const top = data.slice().sort((a,b) => b.risk - a.risk).slice(0, 5);
    top.forEach(r => {
      const li = document.createElement("li");
      li.className = "r-" + r.status.toLowerCase();
      li.innerHTML =
        '<span><span class="risk-name">' + escapeHtml(r.name) + '</span>' +
        '<span class="risk-sub">' + escapeHtml(r.category) + ' &middot; \u20b9' + rupee(r.locked) + ' locked' + (r.cover != null ? ' \u00b7 ' + r.cover + 'd cover' : '') + '</span></span>' +
        '<span class="risk-score">' + r.risk + '</span>';
      list.appendChild(li);
    });
    if (!top.length) list.innerHTML = '<li style="color:var(--muted);">No products yet — add one to get started.</li>';
  }

  /* ============================================================
     RENDER: tables
     ============================================================ */
  function renderTable(data, tbodyId){
    const tbody = $("#" + tbodyId);
    if (!tbody) return;
    tbody.innerHTML = "";

    const filtered = data.filter(r => {
      const matchesFilter = activeFilter === "ALL" || r.status === activeFilter;
      const matchesSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesFilter && matchesSearch;
    });

    if (!filtered.length){
      tbody.innerHTML = '<tr><td colspan="13" style="color:var(--muted); padding:24px 12px;">' +
        (data.length ? "No products match this view." : "No products yet \u2014 click \u201c+ Add product\u201d to get started.") + '</td></tr>';
      return;
    }

    filtered.forEach(r => {
      const tr = document.createElement("tr");
      const leftCls = r.left === 0 ? " is-out" : (r.low ? " is-low" : "");
      tr.innerHTML =
        '<td class="name"><button type="button" class="name-edit" data-id="' + r.id + '">' + escapeHtml(r.name) + '</button>' + (r.isNew ? ' <span class="tag tag-SLOW">NEW</span>' : '') + '</td>' +
        '<td class="cat">' + escapeHtml(r.category) + '</td>' +
        '<td class="num">' + r.stock + '</td>' +
        '<td class="num">\u20b9' + rupee(r.cost) + '</td>' +
        '<td class="num">' + r.sold + '</td>' +
        '<td class="num' + leftCls + '"' + (r.low ? ' title="Running low"' : '') + '>' + r.left + '</td>' +
        '<td class="num">' + r.str.toFixed(1) + '%</td>' +
        '<td class="num">\u20b9' + rupee(r.locked) + '</td>' +
        '<td class="num">' + r.risk + '</td>' +
        '<td><span class="tag tag-' + r.status + '">' + r.status + '</span></td>' +
        '<td class="act">' + escapeHtml(r.action) + '</td><td class="num"><span class="abc abc-' + r.abc + '">' + r.abc + '</span></td>' +
        '<td><button class="row-del" data-id="' + r.id + '" title="Remove product">&times;</button></td>';
      tbody.appendChild(tr);
    });
  }

  function renderSalesTable(){
    const tbody = $("#salesBody");
    if (!tbody) return;
    const products = Store.products();
    const nameOf = (id) => (products.find(p => p.id === id) || {}).name || "(deleted product)";
    const sales = Store.sales().slice().sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 25);
    tbody.innerHTML = "";
    if (!sales.length){
      tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted); padding:20px 12px;">No sales logged yet.</td></tr>';
      return;
    }
    sales.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="name">' + escapeHtml(nameOf(s.productId)) + '</td>' +
        '<td class="num">' + s.qty + '</td>' +
        '<td>' + s.date + '</td>' +
        '<td><button class="row-del" data-sale-id="' + s.id + '" title="Remove entry">&times;</button></td>';
      tbody.appendChild(tr);
    });
  }

  function renderHistoryTable(){
    const tbody = $("#historyBody");
    if (!tbody) return;
    const hist = Store.history().slice().sort((a,b) => b.ts - a.ts);
    tbody.innerHTML = "";
    if (!hist.length){
      tbody.innerHTML = '<tr><td colspan="6" style="color:var(--muted); padding:20px 12px;">No snapshots saved yet — try "Save snapshot now".</td></tr>';
      return;
    }
    hist.forEach(h => {
      const tr = document.createElement("tr");
      const d = new Date(h.ts);
      tr.innerHTML =
        '<td>' + d.toLocaleDateString("en-IN") + ' ' + d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) + '</td>' +
        '<td class="name">' + escapeHtml(h.name) + '</td>' +
        '<td class="num">' + h.str.toFixed(1) + '%</td>' +
        '<td class="num">\u20b9' + rupee(h.locked) + '</td>' +
        '<td class="num">' + h.risk + '</td>' +
        '<td><span class="tag tag-' + h.status + '">' + h.status + '</span></td>';
      tbody.appendChild(tr);
    });
  }

  function populateSaleProductSelect(){
    const sel = $("#s_product");
    const products = Store.products();
    sel.innerHTML = products.map(p => '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join("");
  }

  /* ============================================================
     MASTER RENDER
     ============================================================ */
  function renderAll(){
    const data = rows();
    renderSummary(data);
    renderAlerts(data);
    renderChart(data);
    renderTrend();
    renderDonut(data);
    renderRisk(data);
    renderTable(data, "ledgerBodyFull");
    renderSalesTable();
    renderHistoryTable();
    populateSaleProductSelect();

    const user = Auth.currentUser();
    if (user){
      $("#topbarShop").textContent = user.shop;
      $("#topbarAvatar").textContent = (user.shop || "S").charAt(0).toUpperCase();
    }
  }

  /* ============================================================
     NAVIGATION
     ============================================================ */
  function switchView(view){
    $all(".view").forEach(v => v.hidden = true);
    $("#view-" + view).hidden = false;
    $all(".rail-link").forEach(b => b.classList.toggle("is-active", b.dataset.view === view));
    if (view === "sale") { $("#s_date").value = todayISO(); populateSaleProductSelect(); }
    if (view === "settings"){
      const s = Store.settings();
      $("#t_fast").value = s.fast;
      $("#t_dead").value = s.dead;
      $("#t_low").value = s.lowStock;
      $("#t_cats").value = Object.entries(s.cats || {}).map(([k, v]) => k + ", " + v.fast + ", " + v.dead).join("\n");
      const u = Auth.currentUser();
      if (u){ $("#acctShop").textContent = u.shop; $("#acctUser").textContent = u.username; }
    }
    closeMenu();
    $("#bellMenu").hidden = true;
    if (view === "dashboard" && !$("#appShell").hidden) renderAll();
    window.scrollTo(0, 0);
  }
  function closeMenu(){
    $(".rail").classList.remove("is-open");
    $("#navToggle").setAttribute("aria-expanded", "false");
  }
  $("#navToggle").addEventListener("click", () => {
    const open = $(".rail").classList.toggle("is-open");
    $("#navToggle").setAttribute("aria-expanded", open ? "true" : "false");
  });
  $all(".rail-link").forEach(btn => btn.addEventListener("click", () => switchView(btn.dataset.view)));

  /* ============================================================
     BELL, SHORTCUTS, RESIZE, ALERT CSV
     ============================================================ */
  $("#bellBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const m = $("#bellMenu"); m.hidden = !m.hidden;
    $("#bellBtn").setAttribute("aria-expanded", String(!m.hidden));
  });
  document.addEventListener("click", (e) => {
    const g = e.target.closest("[data-go]");
    if (g){ switchView(g.dataset.go); return; }
    if (!e.target.closest("#bellWrap")) $("#bellMenu").hidden = true;
  });
  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (!$("#appShell").hidden && !$("#view-dashboard").hidden){ const d = rows(); renderChart(d); renderTrend(); } }, 150);
  });
  $("#alertsCsv").addEventListener("click", () => {
    const low = rows().filter(r => r.low).sort((a, b) => a.left - b.left);
    const lines = ["Product,Category,Sold Last 30 Days,Units Left,Alert Level,Cost per Unit"];
    low.forEach(r => lines.push([csvSafe(r.name), csvSafe(r.category), r.sold30, r.left, Store.settings().lowStock, r.cost].join(",")));
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a"); a.href = url; a.download = "reorder-list.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  });

  /* ============================================================
     FILTERS / SEARCH
     ============================================================ */
  $all(".filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      activeFilter = chip.dataset.filter;
      $all(".filter-chip").forEach(c => c.classList.toggle("is-active", c === chip));
      renderAll();
    });
  });
  $("#searchBox2").addEventListener("input", (e) => { searchTerm = e.target.value; renderAll(); });
  $("#trackingPeriod").addEventListener("change", renderAll);

  /* ============================================================
     ROW ACTIONS: delete product / delete sale / open edit modal
     ============================================================ */
  document.addEventListener("click", (e) => {
    const del = e.target.closest(".row-del");
    if (del){
      if (!confirm(del.dataset.id ? "Remove this product and all its sales entries?" : "Remove this sales entry?")) return;
      if (del.dataset.id){
        Store.saveProducts(Store.products().filter(p => p.id !== del.dataset.id));
        Store.saveSales(Store.sales().filter(s => s.productId !== del.dataset.id));
      } else if (del.dataset.saleId){
        Store.saveSales(Store.sales().filter(s => s.id !== del.dataset.saleId));
      }
      renderAll();
      return;
    }
    const editBtn = e.target.closest(".name-edit");
    if (editBtn){ openEditModal(editBtn.dataset.id); }
  });

  /* ============================================================
     CLASSIFICATION DETAIL MODAL (units + products per class)
     ============================================================ */
  function openClassModal(status){
    const labels = { FAST: "Fast moving", SLOW: "Slow moving", DEAD: "Dead stock" };
    const items = rows().filter(r => r.status === status)
      .sort((a, b) => (b.stock * b.cost) - (a.stock * a.cost));
    $("#classModalTitle").textContent = labels[status] + " \u2014 " + items.length + " product" + (items.length === 1 ? "" : "s");
    const tbody = $("#classModalBody");
    tbody.innerHTML = "";
    if (!items.length){
      tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted); padding:20px 12px;">No products in this category.</td></tr>';
    }
    items.forEach(r => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        '<td class="name">' + escapeHtml(r.name) + '</td>' +
        '<td class="cat">' + escapeHtml(r.category) + '</td>' +
        '<td class="num">' + r.stock + '</td>' +
        '<td class="num">' + r.sold + '</td>' +
        '<td class="num">\u20b9' + rupee(r.stock * r.cost) + '</td>';
      tbody.appendChild(tr);
    });
    $("#classModal").hidden = false;
  }
  function closeClassModal(){ $("#classModal").hidden = true; }
  $all(".class-card-btn").forEach(btn => btn.addEventListener("click", () => openClassModal(btn.dataset.class)));
  $("#classModalClose").addEventListener("click", closeClassModal);
  $("#classModal").addEventListener("click", (e) => { if (e.target.id === "classModal") closeClassModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape"){ closeClassModal(); $("#editModal").hidden = true; }
  });

  /* ============================================================
     EDIT MODAL
     ============================================================ */
  function openEditModal(id){
    const p = Store.products().find(x => x.id === id);
    if (!p) return;
    $("#e_id").value = p.id;
    $("#e_name").value = p.name;
    $("#e_category").value = p.category;
    $("#e_stock").value = p.stock;
    $("#e_cost").value = p.cost;
    $("#editModal").hidden = false;
  }
  $("#editCancel").addEventListener("click", () => { $("#editModal").hidden = true; });
  $("#editModal").addEventListener("click", (e) => { if (e.target.id === "editModal") $("#editModal").hidden = true; });
  $("#editForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = $("#e_id").value;
    const stock = parseFloat($("#e_stock").value);
    const cost = parseFloat($("#e_cost").value);
    if (stock < 0 || cost < 0){ alert("Stock and cost can't be negative."); return; }
    const products = Store.products().map(p => p.id === id ? Object.assign({}, p, {
      name: $("#e_name").value.trim(),
      category: $("#e_category").value.trim(),
      stock, cost,
    }) : p);
    Store.saveProducts(products);
    $("#editModal").hidden = true;
    renderAll();
  });

  /* ============================================================
     ADD PRODUCT FORM
     ============================================================ */
  function validateNonNegative(inputId, errId){
    const el = $("#" + inputId);
    const err = $("#" + errId);
    const val = el.value.trim();
    if (val !== "" && Number(val) < 0){
      err.textContent = "Value can't be negative.";
      el.closest(".field").classList.add("has-error");
      return false;
    }
    err.textContent = "";
    el.closest(".field").classList.remove("has-error");
    return true;
  }

  function renderFormPreview(){
    const stock = parseFloat($("#f_stock").value) || 0;
    const cost = parseFloat($("#f_cost").value) || 0;
    if (!stock && !cost){
      $("#pv_str").textContent = "\u2014"; $("#pv_locked").textContent = "\u2014";
      $("#pv_risk").textContent = "\u2014"; $("#pv_status").textContent = "\u2014";
      return;
    }
    const str = Engine.str(stock, 0);
    const locked = Engine.lockedCapital(stock, 0, cost);
    const risk = Engine.riskScore(str, 999);
    const status = Engine.status(0, str, Store.settings());
    $("#pv_str").textContent = str.toFixed(1) + "%";
    $("#pv_locked").textContent = "\u20b9" + rupee(locked);
    $("#pv_risk").textContent = risk;
    $("#pv_status").textContent = status;
  }
  ["f_stock","f_cost"].forEach(id => $("#"+id).addEventListener("input", () => {
    validateNonNegative("f_stock","err_stock"); validateNonNegative("f_cost","err_cost");
    renderFormPreview();
  }));

  $("#addToggle").addEventListener("click", () => {
    const f = $("#productForm"); f.hidden = !f.hidden;
    if (!f.hidden){ $("#f_name").focus(); f.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  });
  $("#addCancel").addEventListener("click", () => { $("#productForm").reset(); $("#productForm").hidden = true; renderFormPreview(); });

  $("#productForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const okStock = validateNonNegative("f_stock","err_stock");
    const okCost = validateNonNegative("f_cost","err_cost");
    if (!okStock || !okCost) return;

    const p = {
      id: uid("p"),
      name: $("#f_name").value.trim(),
      category: $("#f_category").value.trim() || "General",
      stock: Math.round(parseFloat($("#f_stock").value) || 0), added: todayISO(),
      cost: parseFloat($("#f_cost").value) || 0,
    };
    if (!p.name){ toast("Enter a product name."); return; }
    const list = Store.products();
    if (Engine.isDuplicate(list, p.name, p.category)){ toast(p.name + " already exists in " + p.category + ". Edit it instead."); return; }
    list.push(p); Store.saveProducts(list);
    renderAll();
    e.target.reset();
    renderFormPreview();
    $("#productForm").hidden = true;
    toast(p.name + " added to products.", "ok");
  });

  /* ============================================================
     RECORD SALE FORM
     ============================================================ */
  $("#s_qty").addEventListener("input", () => validateNonNegative("s_qty","err_qty"));

  $("#saleForm").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!validateNonNegative("s_qty","err_qty")) return;
    const productId = $("#s_product").value;
    const qty = Number($("#s_qty").value);
    const date = $("#s_date").value || todayISO();
    const msg = $("#saleMsg");
    if (!productId){ msg.textContent = "Add a product first."; return; }
    const row = rows().find(x => x.id === productId);
    const err = Engine.validateSale(qty, row ? row.left : 0, date, todayISO());
    if (err){ msg.style.color = "var(--dead)"; msg.textContent = err; return; }
    msg.style.color = "";

    const sales = Store.sales();
    sales.push({ id: uid("s"), productId, qty, date });
    Store.saveSales(sales);

    // auto-snapshot this product's freshly-recomputed state into history
    snapshotProduct(productId);

    renderAll();
    $("#s_qty").value = "";
    msg.textContent = "Logged " + qty + " unit(s) sold.";
    setTimeout(() => { msg.textContent = ""; }, 3000);
  });

  /* ============================================================
     CLASSIFICATION HISTORY
     ============================================================ */
  function snapshotProduct(productId){
    const data = rows();
    const r = data.find(x => x.id === productId);
    if (!r) return;
    const hist = Store.history();
    hist.push({ ts: Date.now(), productId: r.id, name: r.name, str: r.str, locked: r.locked, risk: r.risk, status: r.status });
    Store.saveHistory(hist.slice(-200)); // cap log length
  }
  function snapshotAll(){
    const data = rows();
    const hist = Store.history();
    const now = Date.now();
    data.forEach(r => hist.push({ ts: now, productId: r.id, name: r.name, str: r.str, locked: r.locked, risk: r.risk, status: r.status }));
    Store.saveHistory(hist.slice(-200));
    renderAll();
  }
  $("#snapshotBtn").addEventListener("click", snapshotAll);
  $("#snapshotBtn2").addEventListener("click", snapshotAll);

  /* ============================================================
     SETTINGS — configurable thresholds
     ============================================================ */
  $("#settingsForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fast = parseInt($("#t_fast").value, 10);
    const dead = parseInt($("#t_dead").value, 10);
    const lowStock = parseInt($("#t_low").value, 10);
    const thErr = Engine.validateThresholds(fast, dead, lowStock);
    if (thErr){
      $("#settingsMsg").textContent = thErr;
      $("#settingsMsg").style.color = "var(--dead)";
      return;
    }
    const cats = {}; let bad = null;
    $("#t_cats").value.split("\n").map(l => l.trim()).filter(Boolean).forEach(l => {
      const [n, f, d] = l.split(",").map(x => x.trim()), F = parseInt(f, 10), D = parseInt(d, 10);
      if (!n || isNaN(F) || isNaN(D) || D < 0 || F > 99 || D >= F) bad = l; else cats[n.toLowerCase()] = { fast: F, dead: D };
    });
    if (bad){
      $("#settingsMsg").textContent = "Fix category line: \"" + bad + "\" (format: Category, fast, dead; dead must be lower than fast).";
      $("#settingsMsg").style.color = "var(--dead)";
      return;
    }
    Store.saveSettings({ fast, dead, lowStock, cats });
    renderAll();
    const msg = $("#settingsMsg");
    msg.style.color = "var(--fast)";
    msg.textContent = "Settings saved — every product re-checked.";
    setTimeout(() => { msg.textContent = ""; }, 3000);
  });

  /* ============================================================
     CSV IMPORT + JSON BACKUP / RESTORE
     ============================================================ */
  const num = (v) => (v == null || String(v).trim() === "") ? NaN : Number(v);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const grid = Engine.parseCsv(String(rd.result).replace(/^\uFEFF/, ""));
      const head = (grid.shift() || []).map(h => h.trim().toLowerCase()), ix = (n) => head.indexOf(n);
      if (["name", "category", "stock", "cost"].some(n => ix(n) < 0)){ toast("CSV needs columns: name, category, stock, cost (optional: sold)."); return; }
      const products = Store.products(), sales = Store.sales(); let added = 0, updated = 0, skipped = 0;
      grid.forEach(r => {
        const name = (r[ix("name")] || "").trim().replace(/^'(?=[=+\-@])/, ""), category = (r[ix("category")] || "").trim() || "General";
        const stock = Math.round(num(r[ix("stock")])), cost = num(r[ix("cost")]), sold = ix("sold") < 0 ? 0 : Math.round(num(r[ix("sold")]) || 0);
        if (!name || !isFinite(stock) || !isFinite(cost) || stock < 0 || cost < 0 || sold < 0 || sold > stock){ skipped++; return; }
        let p = products.find(x => x.name.toLowerCase() === name.toLowerCase() && x.category.toLowerCase() === category.toLowerCase());
        if (p){ p.stock = stock; p.cost = cost; updated++; }
        else { p = { id: uid("p"), name, category, stock, cost, added: todayISO() }; products.push(p); added++; }
        if (sold > 0) sales.push({ id: uid("s"), productId: p.id, qty: sold, date: todayISO() });
      });
      Store.saveProducts(products); Store.saveSales(sales); renderAll();
      toast("Import finished: " + added + " added, " + updated + " updated, " + skipped + " skipped.");
    };
    rd.readAsText(file); e.target.value = "";
  });
  $("#sampleBtn").addEventListener("click", () => {
    if (Store.products().length && !confirm("Replace current products and sales with sample data?")) return;
    Store.saveProducts([]); Store.saveSales([]); Store.seedIfEmpty(); renderAll(); toast("Sample data loaded.");
  });
  $("#backupBtn").addEventListener("click", () => {
    const data = { app: "smart-dead-stock-detector", version: 1, products: Store.products(), sales: Store.sales(), history: Store.history(), settings: Store.settings() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "sdd-backup-" + todayISO() + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  });
  $("#restoreBtn").addEventListener("click", () => $("#restoreFile").click());
  $("#restoreFile").addEventListener("change", (e) => {
    const file = e.target.files[0]; if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      let d; try { d = JSON.parse(rd.result); } catch (err) { toast("That file is not a valid backup."); return; }
      const bErr = Engine.validateBackup(d);
      if (bErr){ toast(bErr); return; }
      if (!confirm("Restoring replaces ALL current data for this shop. Continue?")) return;
      Store.saveProducts(d.products); Store.saveSales(d.sales); Store.saveHistory(Array.isArray(d.history) ? d.history : []);
      Store.saveSettings(Object.assign({ fast: 40, dead: 5, lowStock: 5, cats: {} }, d.settings || {}));
      renderAll(); toast("Backup restored.");
    };
    rd.readAsText(file); e.target.value = "";
  });

  /* ============================================================
     CSV EXPORT / RESET
     ============================================================ */
  function csvSafe(s){ s = String(s); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s; }
  $("#exportCsv").addEventListener("click", () => {
    const data = rows();
    const header = ["Product","Category","Stock","Cost per Unit","Units Sold","Sell-Through Rate %","Locked Capital","Risk Score","Status","Days of Cover","ABC Class","Recommended Action"];
    const lines = [header.join(",")];
    data.forEach(r => lines.push([
      csvSafe(r.name), csvSafe(r.category), r.stock, r.cost, r.sold, r.str.toFixed(1), Math.round(r.locked), r.risk, r.status, r.cover == null ? "" : r.cover, r.abc, csvSafe(r.action)
    ].join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "dead-stock-report.csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  /* ============================================================
     AUTH SCREEN WIRING
     ============================================================ */
  $all(".auth-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $all(".auth-tab").forEach(t => t.classList.toggle("is-active", t === tab));
      $("#loginForm").hidden = tab.dataset.tab !== "login";
      $("#registerForm").hidden = tab.dataset.tab !== "register";
    });
  });

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#loginMsg");
    msg.className = "auth-msg";
    try{
      await Auth.login($("#li_username").value.trim(), $("#li_password").value);
      enterApp();
    }catch(err){
      msg.textContent = err.message;
    }
  });

  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#registerMsg");
    msg.className = "auth-msg";
    const pw = $("#rg_password").value, pw2 = $("#rg_password2").value;
    if (pw !== pw2){ msg.textContent = "Passwords don't match."; return; }
    if (pw.length < 4){ msg.textContent = "Password must be at least 4 characters."; return; }
    try{
      await Auth.register($("#rg_shop").value.trim(), $("#rg_username").value.trim(), pw);
      enterApp();
    }catch(err){
      msg.textContent = err.message;
    }
  });

  $("#logoutBtn").addEventListener("click", () => {
    Auth.logout();
    prevAlerts = null;
    closeMenu();
    $("#appShell").hidden = true;
    $("#authScreen").hidden = false;
    $("#loginForm").reset();
  });

  function enterApp(){
    prevAlerts = null;
    $("#authScreen").hidden = true;
    $("#appShell").hidden = false;
    switchView("dashboard");
    renderFormPreview();
    renderAll();
  }

  /* ============================================================
     INIT
     ============================================================ */
  (async function init(){
    if (Auth.currentUsername()){
      enterApp();
    }
  })();
})();
