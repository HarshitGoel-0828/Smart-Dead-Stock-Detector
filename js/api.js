/* Talks to the Java server. Everything the browser saves or loads goes through here. */
window.SDDApi = (function () {
  "use strict";
  const K_TOKEN = "sdd_token", K_SHOP = "sdd_shop", K_USER = "sdd_user";
  let token = sessionStorage.getItem(K_TOKEN);
  let generation = 0;
  let queue = Promise.resolve();       // saves run one after another, so products always arrive before their sales
  let authLostHandler = null, saveErrorHandler = null;

  async function call(method, path, body, isAuthCall) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = "Bearer " + token;
    let res;
    try {
      res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new Error("Cannot reach the server. Is it running at this address?");
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) {
      if (res.status === 401 && token && !isAuthCall && authLostHandler) authLostHandler();
      const err = new Error((data && data.error) || "Request failed (" + res.status + ")");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function setSession(d, username) {
    token = d.token;
    sessionStorage.setItem(K_TOKEN, d.token);
    sessionStorage.setItem(K_SHOP, d.shopName);
    sessionStorage.setItem(K_USER, username);
  }

  return {
    isLoggedIn: () => !!token,
    shopName: () => sessionStorage.getItem(K_SHOP),
    username: () => sessionStorage.getItem(K_USER),
    onAuthLost: (fn) => { authLostHandler = fn; },
    onSaveError: (fn) => { saveErrorHandler = fn; },

    async register(shopName, username, password) {
      setSession(await call("POST", "/api/register", { shopName, username, password }, true), username);
    },
    async login(username, password) {
      setSession(await call("POST", "/api/login", { username, password }, true), username);
    },
    async logout() {
      try { await call("POST", "/api/logout", undefined, true); } catch (e) { /* already logged out */ }
      token = null;
      sessionStorage.removeItem(K_TOKEN); sessionStorage.removeItem(K_SHOP); sessionStorage.removeItem(K_USER);
    },
    loadState: () => call("GET", "/api/state"),

    /** name is products | sales | history | settings */
    save(name, value) {
      const gen = generation;                       // saves queued before a failure are dropped (they would write stale data)
      queue = queue
        .then(() => (gen !== generation ? undefined : call("PUT", "/api/" + name, value)))
        .catch((e) => { generation++; if (saveErrorHandler) saveErrorHandler(e); });
      return queue;
    },
    /** Resolves when every queued save has finished (or failed). */
    flush: () => queue
  };
})();
