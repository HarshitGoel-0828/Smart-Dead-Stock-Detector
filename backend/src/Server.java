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

/** The Java backend. Serves the web app and (soon) the JSON API. Run it from the backend folder. */
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