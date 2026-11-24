import java.net.URI;
import java.net.http.*;
import java.util.*;
public class RouteTest {
    static HttpClient c = HttpClient.newHttpClient();
    static int fails = 0;
    static HttpResponse<String> req(String method, String path, String token, String body) throws Exception {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create("http://localhost:8080" + path));
        if (token != null) b.header("Authorization", "Bearer " + token);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return c.send(b.build(), HttpResponse.BodyHandlers.ofString());
    }
    static void check(String name, boolean ok, String detail) { System.out.println((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "  -> " + detail)); if (!ok) fails++; }
    public static void main(String[] a) throws Exception {
        Server.store = new MemStore();
        Server.main(new String[0]);
        String t1 = Auth.newSession(1), t2 = Auth.newSession(2);
        HttpResponse<String> r;
        r = req("GET", "/api/state", null, null); check("state without token -> 401", r.statusCode() == 401, r.body());
        r = req("GET", "/api/state", "bogus", null); check("state bad token -> 401", r.statusCode() == 401, r.body());
        r = req("GET", "/api/state", t1, null); check("empty state ok", r.statusCode() == 200 && r.body().contains("\"products\":[]") && r.body().contains("\"settings\":{}"), r.body());
        r = req("POST", "/api/products", t1, "[]"); check("wrong method -> 405", r.statusCode() == 405, r.body());
        String prods = "[{\"id\":\"p1\",\"name\":\"USB Cable\",\"category\":\"Accessories\",\"stock\":40,\"cost\":80,\"added\":\"2026-01-01\"},{\"id\":\"p2\",\"name\":\"Mouse\",\"category\":\"\",\"stock\":25,\"cost\":80.5,\"added\":\"2026-02-01\"}]";
        r = req("PUT", "/api/products", t1, prods); check("save products", r.statusCode() == 200 && r.body().contains("\"saved\":2"), r.body());
        r = req("PUT", "/api/products", t1, "[{\"id\":\"p1\",\"name\":\"\",\"category\":\"x\",\"stock\":1,\"cost\":1,\"added\":\"2026-01-01\"}]"); check("blank name -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/products", t1, "[{\"id\":\"p1\",\"name\":\"A\",\"category\":\"x\",\"stock\":-5,\"cost\":1,\"added\":\"2026-01-01\"}]"); check("negative stock -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/products", t1, "[{\"id\":\"p1\",\"name\":\"A\",\"category\":\"x\",\"stock\":1.5,\"cost\":1,\"added\":\"2026-01-01\"}]"); check("decimal stock -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/products", t1, "[{\"id\":\"p1\",\"name\":\"A\",\"category\":\"x\",\"stock\":1,\"cost\":1,\"added\":\"2026-02-31\"}]"); check("impossible date -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/products", t1, "[{\"id\":\"bad id!\",\"name\":\"A\",\"category\":\"x\",\"stock\":1,\"cost\":1,\"added\":\"2026-01-01\"}]"); check("bad id -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/products", t1, "[{\"id\":\"a\",\"name\":\"A\",\"category\":\"x\",\"stock\":1,\"cost\":1,\"added\":\"2026-01-01\"},{\"id\":\"b\",\"name\":\"a\",\"category\":\"X\",\"stock\":1,\"cost\":1,\"added\":\"2026-01-01\"}]"); check("duplicate name+category -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/products", t1, "not json"); check("garbage -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/products", t1, "{\"a\":1}"); check("object instead of list -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/sales", t1, "[{\"id\":\"s1\",\"productId\":\"nope\",\"qty\":2,\"date\":\"2026-11-20\"}]"); check("sale for unknown product -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/sales", t2, "[{\"id\":\"s1\",\"productId\":\"p1\",\"qty\":2,\"date\":\"2026-11-20\"}]"); check("other user cannot sell my product -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/sales", t1, "[{\"id\":\"s1\",\"productId\":\"p1\",\"qty\":3,\"date\":\"2026-11-20\"}]"); check("save sales", r.statusCode() == 200, r.body());
        r = req("PUT", "/api/history", t1, "[{\"ts\":1790000000000,\"productId\":\"p1\",\"name\":\"USB Cable\",\"str\":7.5,\"locked\":2960,\"risk\":40,\"status\":\"SLOW\"}]"); check("save history", r.statusCode() == 200, r.body());
        r = req("PUT", "/api/history", t1, "[{\"ts\":1,\"productId\":\"p1\",\"name\":\"x\",\"str\":7.5,\"locked\":1,\"risk\":40,\"status\":\"WEIRD\"}]"); check("bad status -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/settings", t1, "{\"fast\":40,\"dead\":5,\"lowStock\":5,\"period\":60,\"cats\":{\"Groceries\":{\"fast\":60,\"dead\":10}}}"); check("save settings", r.statusCode() == 200, r.body());
        r = req("PUT", "/api/settings", t1, "{\"fast\":5,\"dead\":40,\"lowStock\":5}"); check("dead>=fast -> 400", r.statusCode() == 400, r.body());
        r = req("PUT", "/api/settings", t1, "{\"fast\":\"x\",\"dead\":4,\"lowStock\":5}"); check("text threshold -> 400", r.statusCode() == 400, r.body());
        r = req("GET", "/api/state", t1, null);
        check("round trip", r.statusCode() == 200 && r.body().contains("\"name\":\"USB Cable\"") && r.body().contains("\"category\":\"General\"") && r.body().contains("\"cost\":80.5") && r.body().contains("\"qty\":3") && r.body().contains("\"period\":60") && r.body().contains("Groceries"), r.body());
        System.out.println(r.body());
        r = req("GET", "/api/state", t2, null); check("user 2 sees nothing of user 1", r.body().contains("\"products\":[]"), r.body());
        r = req("POST", "/api/logout", t1, null); check("logout", r.statusCode() == 200, r.body());
        r = req("GET", "/api/state", t1, null); check("token dead after logout", r.statusCode() == 401, r.body());
        r = req("GET", "/backend/config.properties", null, null); check("config not served", r.statusCode() == 404, r.body());
        r = req("GET", "/../etc/passwd", null, null); check("path traversal blocked", r.statusCode() == 404, r.body());
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails);
    }
}
