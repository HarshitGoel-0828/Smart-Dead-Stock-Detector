import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
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

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.createContext("/api/health", Server::health);
        server.createContext("/api/register", Server::register);
        server.createContext("/api/login", Server::login);
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
            send(ex, 200, TYPES.get("json"), "{\"token\":" + Json.quote(Auth.newSession(u.id)) + ",\"shopName\":" + Json.quote(u.shopName) + "}");
        } catch (SQLException e) {
            error(ex, 500, "Database error");
        }
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