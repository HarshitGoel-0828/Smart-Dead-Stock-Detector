import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.sql.SQLIntegrityConstraintViolationException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.concurrent.Executors;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Map;
import java.util.Set;

/** The Java backend. Serves the web app and the JSON API. Run it from the backend folder. */
public class Server {
    static final int PORT = 8080;
    // The web app lives one folder up. Only these top-level names are ever served,
    // so backend/config.properties (your password) can never be downloaded.
    static final Path WEB_ROOT = Paths.get("..").toAbsolutePath().normalize();
    static final Set<String> PUBLIC = Set.of("index.html", "css", "js", "sample-import.csv");
    static final Map<String, String> TYPES = Map.of(
        "html", "text/html; charset=utf-8",
        "css", "text/css; charset=utf-8",
        "js", "application/javascript; charset=utf-8",
        "csv", "text/csv; charset=utf-8",
        "json", "application/json; charset=utf-8",
        "png", "image/png",
        "svg", "image/svg+xml");

    static final int MAX_BODY = 5_000_000;
    /** The real database. Tests can swap this for a fake. */
    static DataStore store = new MySqlStore();

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.setExecutor(Executors.newFixedThreadPool(8));
        server.createContext("/api/health", Server::health);
        server.createContext("/api/register", Server::register);
        server.createContext("/api/login", Server::login);
        server.createContext("/api/logout", Server::logout);
        server.createContext("/api/state", Server::state);
        server.createContext("/api/products", ex -> save(ex, "products"));
        server.createContext("/api/sales", ex -> save(ex, "sales"));
        server.createContext("/api/history", ex -> save(ex, "history"));
        server.createContext("/api/settings", ex -> save(ex, "settings"));
        server.createContext("/api/activity", Server::activity);
        server.createContext("/api/password", Server::password);
        server.createContext("/", Server::staticFile);
        server.start();
        System.out.println("Server running at http://localhost:" + PORT + "  (press Ctrl + C to stop)");
    }

    static void health(HttpExchange ex) throws IOException {
        try (Connection c = Db.get();
             Statement st = c.createStatement();
             ResultSet rs = st.executeQuery("SELECT COUNT(*) FROM users")) {
            rs.next();
            send(ex, 200, TYPES.get("json"), "{\"status\":\"ok\",\"users\":" + rs.getInt(1) + "}");
        } catch (SQLException e) {
            send(ex, 500, TYPES.get("json"), "{\"status\":\"error\",\"message\":\"database not reachable\"}");
        }
    }

    static void register(HttpExchange ex) throws IOException {
        Map<String, String> in = readBody(ex);
        if (in == null) return;
        String shop = in.getOrDefault("shopName", "").trim();
        String username = in.getOrDefault("username", "").trim();
        String password = in.getOrDefault("password", "");
        if (shop.isEmpty() || shop.length() > 80) { error(ex, 400, "Shop name must be 1 to 80 characters"); return; }
        if (!username.matches("[A-Za-z0-9_.]{3,40}")) { error(ex, 400, "Username must be 3 to 40 letters, numbers, _ or ."); return; }
        if (password.length() < 6 || password.length() > 100) { error(ex, 400, "Password must be 6 to 100 characters"); return; }
        try {
            int id = UserDao.create(shop, username, Auth.hashPassword(password));
            if (id < 0) { error(ex, 409, "That username is already taken"); return; }
            logQuiet(id, "REGISTERED", "Account created for " + shop);
            send(ex, 201, TYPES.get("json"), "{\"token\":" + Json.quote(Auth.newSession(id)) + ",\"shopName\":" + Json.quote(shop) + "}");
        } catch (SQLException e) {
            error(ex, 500, "Database error");
        }
    }

    static void login(HttpExchange ex) throws IOException {
        Map<String, String> in = readBody(ex);
        if (in == null) return;
        String username = in.getOrDefault("username", "").trim();
        String password = in.getOrDefault("password", "");
        try {
            UserDao.User u = UserDao.find(username);
            if (u == null || !Auth.verifyPassword(password, u.passwordHash)) {
                error(ex, 401, "Wrong username or password");
                return;
            }
            logQuiet(u.id, "LOGIN", "Logged in");
            send(ex, 200, TYPES.get("json"), "{\"token\":" + Json.quote(Auth.newSession(u.id)) + ",\"shopName\":" + Json.quote(u.shopName) + "}");
        } catch (SQLException e) {
            error(ex, 500, "Database error");
        }
    }


    /** Returns the logged-in user id from the "Authorization: Bearer <token>" header, or sends 401 and returns null. */
    static Integer auth(HttpExchange ex) throws IOException {
        String h = ex.getRequestHeaders().getFirst("Authorization");
        Integer uid = (h != null && h.startsWith("Bearer ")) ? Auth.userForToken(h.substring(7).trim()) : null;
        if (uid == null) error(ex, 401, "Please log in again");
        return uid;
    }

    static void logout(HttpExchange ex) throws IOException {
        if (!ex.getRequestMethod().equals("POST")) { error(ex, 405, "Use POST"); return; }
        String h = ex.getRequestHeaders().getFirst("Authorization");
        if (h != null && h.startsWith("Bearer ")) Auth.endSession(h.substring(7).trim());
        send(ex, 200, TYPES.get("json"), "{\"ok\":true}");
    }

    /** Everything the app needs after login, in one reply. */
    static void state(HttpExchange ex) throws IOException {
        if (!ex.getRequestMethod().equals("GET")) { error(ex, 405, "Use GET"); return; }
        Integer uid = auth(ex);
        if (uid == null) return;
        try {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("products", store.products(uid));
            out.put("sales", store.sales(uid));
            out.put("history", store.history(uid));
            Map<String, Object> s = store.settings(uid);
            out.put("settings", s == null ? new LinkedHashMap<String, Object>() : s);
            send(ex, 200, TYPES.get("json"), Json.write(out));
        } catch (SQLException e) {
            dbError(ex, e);
        }
    }

    /** PUT /api/products | sales | history | settings: validates the whole list, then saves it for this user. */
    static void save(HttpExchange ex, String what) throws IOException {
        if (!ex.getRequestMethod().equals("PUT")) { error(ex, 405, "Use PUT"); return; }
        Integer uid = auth(ex);
        if (uid == null) return;
        byte[] raw = ex.getRequestBody().readNBytes(MAX_BODY + 1);
        if (raw.length > MAX_BODY) { error(ex, 413, "Too much data"); return; }
        Object body;
        try {
            body = Json.parse(new String(raw, StandardCharsets.UTF_8));
        } catch (RuntimeException e) {
            error(ex, 400, "Request is not valid JSON");
            return;
        }
        try {
            int saved;
            switch (what) {
                case "products": {
                    List<Map<String, Object>> before = store.products(uid);
                    List<Map<String, Object>> list = Validate.products(body);
                    store.saveProducts(uid, list);
                    logAll(uid, ActivityLog.productChanges(before, list));
                    saved = list.size();
                    break;
                }
                case "sales": {
                    Set<String> ids = new HashSet<>();
                    Map<String, String> names = new HashMap<>();
                    for (Map<String, Object> p : store.products(uid)) {
                        ids.add((String) p.get("id"));
                        names.put((String) p.get("id"), (String) p.get("name"));
                    }
                    List<Map<String, Object>> before = store.sales(uid);
                    List<Map<String, Object>> list = Validate.sales(body, ids);
                    store.saveSales(uid, list);
                    logAll(uid, ActivityLog.saleChanges(before, list, names));
                    saved = list.size();
                    break;
                }
                case "history": {
                    List<Map<String, Object>> list = Validate.history(body);
                    store.saveHistory(uid, list);
                    saved = list.size();
                    break;
                }
                default: {
                    Map<String, Object> before = store.settings(uid);
                    Map<String, Object> now = Validate.settings(body);
                    store.saveSettings(uid, now);
                    ActivityLog.Entry change = ActivityLog.settingsChange(before, now);
                    if (change != null) logQuiet(uid, change.action, change.details);
                    saved = 1;
                }
            }
            send(ex, 200, TYPES.get("json"), "{\"ok\":true,\"saved\":" + saved + "}");
        } catch (Validate.Invalid e) {
            error(ex, 400, e.getMessage());
        } catch (SQLIntegrityConstraintViolationException e) {
            e.printStackTrace();
            error(ex, 409, "Conflict: a product or sale with the same name or id already exists");
        } catch (SQLException e) {
            dbError(ex, e);
        }
    }


    /** Writing the activity log must never make a real save fail, so problems are only printed. */
    static void logQuiet(int uid, String action, String details) {
        try {
            store.log(uid, action, details);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    static void logAll(int uid, List<ActivityLog.Entry> entries) {
        for (ActivityLog.Entry e : entries) logQuiet(uid, e.action, e.details);
    }

    /** GET /api/activity?limit=100 : the newest log lines for this shop. */
    static void activity(HttpExchange ex) throws IOException {
        if (!ex.getRequestMethod().equals("GET")) { error(ex, 405, "Use GET"); return; }
        Integer uid = auth(ex);
        if (uid == null) return;
        int limit = 100;
        String q = ex.getRequestURI().getQuery();
        if (q != null && q.startsWith("limit=")) {
            try { limit = Integer.parseInt(q.substring(6)); } catch (NumberFormatException e) { /* keep 100 */ }
        }
        limit = Math.max(1, Math.min(500, limit));
        try {
            send(ex, 200, TYPES.get("json"), Json.write(store.activity(uid, limit)));
        } catch (SQLException e) {
            dbError(ex, e);
        }
    }

    /** POST /api/password {"current":"...","newPassword":"..."} */
    static void password(HttpExchange ex) throws IOException {
        Integer uid = auth(ex);
        if (uid == null) return;
        Map<String, String> in = readBody(ex);
        if (in == null) return;
        String current = in.getOrDefault("current", ""), next = in.getOrDefault("newPassword", "");
        if (next.length() < 6 || next.length() > 100) { error(ex, 400, "New password must be 6 to 100 characters"); return; }
        try {
            String[] user = store.userById(uid);
            // 400, not 401: a wrong current password must not look like an expired login
            if (user == null || !Auth.verifyPassword(current, user[1])) { error(ex, 400, "Current password is incorrect"); return; }
            if (next.equals(current)) { error(ex, 400, "Choose a password different from the current one"); return; }
            store.updatePassword(uid, Auth.hashPassword(next));
            String token = ex.getRequestHeaders().getFirst("Authorization").substring(7).trim();
            Auth.endOtherSessions(uid, token);
            logQuiet(uid, "PASSWORD_CHANGED", "Password changed");
            send(ex, 200, TYPES.get("json"), "{\"ok\":true}");
        } catch (SQLException e) {
            dbError(ex, e);
        }
    }

    static void dbError(HttpExchange ex, SQLException e) throws IOException {
        e.printStackTrace(); // shown in the server window, so problems are easy to find
        error(ex, 500, "Database error");
    }

    /** Reads a POST body as flat JSON. Sends the error reply itself and returns null if it is not valid. */
    static Map<String, String> readBody(HttpExchange ex) throws IOException {
        if (!ex.getRequestMethod().equals("POST")) { error(ex, 405, "Use POST"); return null; }
        byte[] raw = ex.getRequestBody().readNBytes(10_000);
        try {
            return Json.parseFlat(new String(raw, StandardCharsets.UTF_8));
        } catch (RuntimeException e) {
            error(ex, 400, "Request must be a JSON object with text values");
            return null;
        }
    }

    static void error(HttpExchange ex, int code, String message) throws IOException {
        send(ex, code, TYPES.get("json"), "{\"error\":" + Json.quote(message) + "}");
    }

    static void staticFile(HttpExchange ex) throws IOException {
        String path = ex.getRequestURI().getPath();
        if (path.equals("/")) path = "/index.html";
        Path file = WEB_ROOT.resolve(path.substring(1)).normalize();
        Path rel = WEB_ROOT.relativize(file);
        boolean allowed = file.startsWith(WEB_ROOT) && rel.getNameCount() > 0 && PUBLIC.contains(rel.getName(0).toString());
        if (!allowed || !Files.isRegularFile(file)) {
            send(ex, 404, "text/plain; charset=utf-8", "Not found");
            return;
        }
        String name = file.getFileName().toString();
        String ext = name.substring(name.lastIndexOf('.') + 1).toLowerCase();
        send(ex, 200, TYPES.getOrDefault(ext, "application/octet-stream"), Files.readAllBytes(file));
    }

    static void send(HttpExchange ex, int code, String type, String body) throws IOException {
        send(ex, code, type, body.getBytes(StandardCharsets.UTF_8));
    }

    static void send(HttpExchange ex, int code, String type, byte[] body) throws IOException {
        ex.getResponseHeaders().set("Content-Type", type);
        ex.sendResponseHeaders(code, body.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(body);
        }
    }
}
