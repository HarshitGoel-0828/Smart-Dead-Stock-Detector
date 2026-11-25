import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Works out what changed between the old and the new list the browser sends, and turns it into
 * readable activity-log lines. Pure logic with no database access, so it is easy to test.
 */
public class ActivityLog {
    public static class Entry {
        public final String action, details;
        public Entry(String action, String details) { this.action = action; this.details = details; }
    }

    static final int MAX_LINES = 6; // more changes than this are summarised in one line

    static String num(Object o) {
        double d = ((Number) o).doubleValue();
        return d == Math.rint(d) ? String.valueOf((long) d) : String.valueOf(d);
    }

    static Map<String, Map<String, Object>> byId(List<Map<String, Object>> l) {
        Map<String, Map<String, Object>> m = new LinkedHashMap<>();
        for (Map<String, Object> x : l) m.put((String) x.get("id"), x);
        return m;
    }

    public static List<Entry> productChanges(List<Map<String, Object>> before, List<Map<String, Object>> after) {
        Map<String, Map<String, Object>> b = byId(before), a = byId(after);
        List<Entry> added = new ArrayList<>(), removed = new ArrayList<>(), edited = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> e : a.entrySet()) {
            Map<String, Object> n = e.getValue(), o = b.get(e.getKey());
            if (o == null) {
                added.add(new Entry("PRODUCT_ADDED", "Added " + n.get("name") + " (" + n.get("category") + ", stock " + num(n.get("stock")) + ", cost Rs " + num(n.get("cost")) + ")"));
                continue;
            }
            List<String> parts = new ArrayList<>();
            if (!o.get("name").equals(n.get("name"))) parts.add("name " + o.get("name") + " -> " + n.get("name"));
            if (!o.get("category").equals(n.get("category"))) parts.add("category " + o.get("category") + " -> " + n.get("category"));
            if (((Number) o.get("stock")).longValue() != ((Number) n.get("stock")).longValue()) parts.add("stock " + num(o.get("stock")) + " -> " + num(n.get("stock")));
            if (Math.abs(((Number) o.get("cost")).doubleValue() - ((Number) n.get("cost")).doubleValue()) > 0.004) parts.add("cost Rs " + num(o.get("cost")) + " -> Rs " + num(n.get("cost")));
            if (!parts.isEmpty()) edited.add(new Entry("PRODUCT_EDITED", "Edited " + n.get("name") + ": " + String.join(", ", parts)));
        }
        for (Map.Entry<String, Map<String, Object>> e : b.entrySet()) {
            if (!a.containsKey(e.getKey())) removed.add(new Entry("PRODUCT_REMOVED", "Removed " + e.getValue().get("name")));
        }
        int total = added.size() + removed.size() + edited.size();
        List<Entry> out = new ArrayList<>();
        if (total > MAX_LINES) {
            out.add(new Entry("PRODUCTS_BULK", "Bulk update: " + added.size() + " added, " + removed.size() + " removed, " + edited.size() + " edited"));
        } else {
            out.addAll(added); out.addAll(edited); out.addAll(removed);
        }
        return out;
    }

    public static List<Entry> saleChanges(List<Map<String, Object>> before, List<Map<String, Object>> after, Map<String, String> productNames) {
        Map<String, Map<String, Object>> b = byId(before), a = byId(after);
        List<Entry> added = new ArrayList<>(), removed = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> e : a.entrySet()) {
            if (!b.containsKey(e.getKey())) added.add(new Entry("SALE_ADDED", "Recorded sale: " + line(e.getValue(), productNames)));
        }
        for (Map.Entry<String, Map<String, Object>> e : b.entrySet()) {
            if (!a.containsKey(e.getKey())) removed.add(new Entry("SALE_REMOVED", "Removed sale: " + line(e.getValue(), productNames)));
        }
        List<Entry> out = new ArrayList<>();
        if (added.size() + removed.size() > MAX_LINES) {
            out.add(new Entry("SALES_BULK", "Bulk update: " + added.size() + " sales added, " + removed.size() + " removed"));
        } else {
            out.addAll(added); out.addAll(removed);
        }
        return out;
    }

    private static String line(Map<String, Object> s, Map<String, String> names) {
        String name = names.getOrDefault((String) s.get("productId"), "a removed product");
        return num(s.get("qty")) + " x " + name + " (" + s.get("date") + ")";
    }

    /** old may be null when the shop never saved settings; the app's defaults are used then. */
    public static Entry settingsChange(Map<String, Object> old, Map<String, Object> now) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("fast", 40L); o.put("dead", 5L); o.put("lowStock", 5L); o.put("period", 30L); o.put("cats", new LinkedHashMap<String, Object>());
        if (old != null) o.putAll(old);
        List<String> parts = new ArrayList<>();
        diff(parts, "FAST threshold", o.get("fast"), now.get("fast"), "%");
        diff(parts, "DEAD threshold", o.get("dead"), now.get("dead"), "%");
        diff(parts, "reorder level", o.get("lowStock"), now.get("lowStock"), "");
        diff(parts, "tracking period", o.get("period"), now.get("period"), " days");
        if (!String.valueOf(o.get("cats")).equals(String.valueOf(now.get("cats"))) && !o.get("cats").equals(now.get("cats"))) parts.add("category overrides updated");
        return parts.isEmpty() ? null : new Entry("SETTINGS_CHANGED", "Changed " + String.join(", ", parts));
    }

    private static void diff(List<String> parts, String label, Object a, Object b, String unit) {
        if (((Number) a).longValue() != ((Number) b).longValue()) parts.add(label + " " + num(a) + unit + " -> " + num(b) + unit);
    }
}
