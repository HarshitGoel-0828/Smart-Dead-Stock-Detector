import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Server-side checks for everything the browser sends. The same rules as the app, enforced again here. */
public class Validate {
    public static class Invalid extends RuntimeException {
        public Invalid(String m) { super(m); }
    }

    static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{1,40}");
    static final Set<String> STATUS = Set.of("FAST", "SLOW", "DEAD");
    static final int MAX_ROWS = 20000;

    public static List<Map<String, Object>> products(Object body) {
        List<Object> in = list(body, "products");
        List<Map<String, Object>> out = new ArrayList<>();
        Set<String> ids = new HashSet<>(), keys = new HashSet<>();
        for (Object o : in) {
            Map<String, Object> m = map(o, "product");
            String id = id(m.get("id"), "product id");
            String name = text(m.get("name"), 80, true, "Product name");
            String cat = text(m.get("category"), 60, false, "Category");
            if (cat.isEmpty()) cat = "General";
            long stock = whole(m.get("stock"), 0, 100_000_000L, "Stock");
            double cost = decimal(m.get("cost"), 0, 100_000_000d, "Cost");
            String added = date(m.get("added"), "Date added");
            if (!ids.add(id)) throw new Invalid("Duplicate product id " + id);
            if (!keys.add((name + "|" + cat).toLowerCase())) throw new Invalid(name + " appears twice in " + cat);
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("id", id); p.put("name", name); p.put("category", cat);
            p.put("stock", stock); p.put("cost", cost); p.put("added", added);
            out.add(p);
        }
        return out;
    }

    public static List<Map<String, Object>> sales(Object body, Set<String> productIds) {
        List<Object> in = list(body, "sales");
        List<Map<String, Object>> out = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Object o : in) {
            Map<String, Object> m = map(o, "sale");
            String id = id(m.get("id"), "sale id");
            String pid = id(m.get("productId"), "product id");
            if (!productIds.contains(pid)) throw new Invalid("A sale refers to a product that does not exist");
            long qty = whole(m.get("qty"), 0, 100_000_000L, "Units sold");
            String date = date(m.get("date"), "Sale date");
            if (!ids.add(id)) throw new Invalid("Duplicate sale id " + id);
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("id", id); s.put("productId", pid); s.put("qty", qty); s.put("date", date);
            out.add(s);
        }
        return out;
    }

    public static List<Map<String, Object>> history(Object body) {
        List<Object> in = list(body, "history");
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : in) {
            Map<String, Object> m = map(o, "history entry");
            String status = String.valueOf(m.get("status"));
            if (!STATUS.contains(status)) throw new Invalid("Bad status in history");
            Map<String, Object> h = new LinkedHashMap<>();
            h.put("ts", whole(m.get("ts"), 0, 9_000_000_000_000L, "Timestamp"));
            h.put("productId", id(m.get("productId"), "product id"));
            h.put("name", text(m.get("name"), 80, true, "Product name"));
            h.put("str", decimal(m.get("str"), 0, 100, "STR"));
            h.put("locked", decimal(m.get("locked"), 0, 1_000_000_000d, "Locked capital"));
            h.put("risk", whole(m.get("risk"), 0, 100, "Risk"));
            h.put("status", status);
            out.add(h);
        }
        return out;
    }

    public static Map<String, Object> settings(Object body) {
        Map<String, Object> m = map(body, "settings");
        long fast = whole(m.get("fast"), 1, 99, "FAST threshold");
        long dead = whole(m.get("dead"), 0, 98, "DEAD threshold");
        long low = whole(m.get("lowStock"), 0, 1_000_000, "Low-stock level");
        long period = m.get("period") == null ? 30 : whole(m.get("period"), 1, 365, "Tracking period");
        if (dead >= fast) throw new Invalid("The DEAD threshold must be lower than the FAST threshold");
        Map<String, Object> cats = new LinkedHashMap<>();
        Object c = m.get("cats");
        if (c != null) {
            Map<String, Object> cm = map(c, "category thresholds");
            if (cm.size() > 200) throw new Invalid("Too many category thresholds");
            for (Map.Entry<String, Object> e : cm.entrySet()) {
                Map<String, Object> v = map(e.getValue(), "category threshold");
                long cf = whole(v.get("fast"), 1, 99, "Category FAST threshold");
                long cd = whole(v.get("dead"), 0, 98, "Category DEAD threshold");
                if (cd >= cf) throw new Invalid("Category DEAD threshold must be lower than FAST");
                Map<String, Object> one = new LinkedHashMap<>();
                one.put("fast", cf); one.put("dead", cd);
                cats.put(text(e.getKey(), 60, true, "Category name"), one);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("fast", fast); out.put("dead", dead); out.put("lowStock", low); out.put("period", period); out.put("cats", cats);
        return out;
    }

    // ---- small helpers ----
    @SuppressWarnings("unchecked")
    static List<Object> list(Object o, String what) {
        if (!(o instanceof List)) throw new Invalid("Expected a list of " + what);
        List<Object> l = (List<Object>) o;
        if (l.size() > MAX_ROWS) throw new Invalid("Too many " + what);
        return l;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o, String what) {
        if (!(o instanceof Map)) throw new Invalid("Expected an object for " + what);
        return (Map<String, Object>) o;
    }

    static String id(Object o, String what) {
        if (!(o instanceof String) || !ID.matcher((String) o).matches()) throw new Invalid("Invalid " + what);
        return (String) o;
    }

    static String text(Object o, int max, boolean required, String what) {
        String s = o == null ? "" : String.valueOf(o).trim();
        if (required && s.isEmpty()) throw new Invalid(what + " is required");
        if (s.length() > max) throw new Invalid(what + " is too long");
        return s;
    }

    static long whole(Object o, long min, long max, String what) {
        if (o instanceof Double) {
            double d = (Double) o;
            if (d != Math.rint(d)) throw new Invalid(what + " must be a whole number");
            o = (long) d;
        }
        if (!(o instanceof Long)) throw new Invalid(what + " must be a number");
        long v = (Long) o;
        if (v < min || v > max) throw new Invalid(what + " must be between " + min + " and " + max);
        return v;
    }

    static double decimal(Object o, double min, double max, String what) {
        if (!(o instanceof Number)) throw new Invalid(what + " must be a number");
        double d = ((Number) o).doubleValue();
        if (Double.isNaN(d) || d < min || d > max) throw new Invalid(what + " must be between " + min + " and " + max);
        return d;
    }

    static String date(Object o, String what) {
        if (!(o instanceof String)) throw new Invalid(what + " must be a date");
        try {
            return LocalDate.parse((String) o).toString();
        } catch (RuntimeException e) {
            throw new Invalid(what + " must be a valid date (YYYY-MM-DD)");
        }
    }
}
