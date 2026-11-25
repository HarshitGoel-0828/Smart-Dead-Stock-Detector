import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Small JSON reader/writer (no libraries needed).
 * parse() gives Map / List / String / Long / Double / Boolean / null. write() does the reverse.
 */
public class Json {
    private static final int MAX_DEPTH = 20;

    public static Object parse(String s) {
        int[] i = {0};
        skip(s, i);
        Object v = value(s, i, 0);
        skip(s, i);
        if (i[0] != s.length()) throw new IllegalArgumentException("Bad JSON");
        return v;
    }

    /** Reads a flat object of text values, e.g. {"a":"b"} (used by register and login). */
    public static Map<String, String> parseFlat(String s) {
        Object o = parse(s);
        if (!(o instanceof Map)) throw new IllegalArgumentException("Expected a JSON object");
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
            if (!(e.getValue() instanceof String)) throw new IllegalArgumentException("Only text values are allowed");
            out.put((String) e.getKey(), (String) e.getValue());
        }
        return out;
    }

    public static String write(Object o) {
        StringBuilder b = new StringBuilder();
        write(o, b);
        return b.toString();
    }

    public static String quote(String v) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : v.toCharArray()) {
            switch (c) {
                case '"': b.append("\\\""); break;
                case '\\': b.append("\\\\"); break;
                case '\n': b.append("\\n"); break;
                case '\r': b.append("\\r"); break;
                case '\t': b.append("\\t"); break;
                default:
                    if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
                    else b.append(c);
            }
        }
        return b.append('"').toString();
    }

    private static void write(Object o, StringBuilder b) {
        if (o == null) { b.append("null"); return; }
        if (o instanceof String) { b.append(quote((String) o)); return; }
        if (o instanceof Boolean) { b.append(o); return; }
        if (o instanceof Double || o instanceof Float) {
            double d = ((Number) o).doubleValue();
            if (Double.isNaN(d) || Double.isInfinite(d)) b.append("null");
            else b.append(BigDecimal.valueOf(d).stripTrailingZeros().toPlainString());
            return;
        }
        if (o instanceof BigDecimal) { b.append(((BigDecimal) o).stripTrailingZeros().toPlainString()); return; }
        if (o instanceof Number) { b.append(o); return; }
        if (o instanceof Map) {
            b.append('{');
            boolean first = true;
            for (Map.Entry<?, ?> e : ((Map<?, ?>) o).entrySet()) {
                if (!first) b.append(',');
                first = false;
                b.append(quote(String.valueOf(e.getKey()))).append(':');
                write(e.getValue(), b);
            }
            b.append('}');
            return;
        }
        if (o instanceof List) {
            b.append('[');
            boolean first = true;
            for (Object x : (List<?>) o) {
                if (!first) b.append(',');
                first = false;
                write(x, b);
            }
            b.append(']');
            return;
        }
        throw new IllegalArgumentException("Cannot write " + o.getClass());
    }

    private static Object value(String s, int[] i, int depth) {
        if (depth > MAX_DEPTH) throw new IllegalArgumentException("JSON is nested too deeply");
        char c = peek(s, i);
        if (c == '{') {
            i[0]++;
            Map<String, Object> m = new LinkedHashMap<>();
            skip(s, i);
            if (peek(s, i) == '}') { i[0]++; return m; }
            while (true) {
                skip(s, i);
                String k = readString(s, i);
                skip(s, i);
                expect(s, i, ':');
                skip(s, i);
                m.put(k, value(s, i, depth + 1));
                skip(s, i);
                char d = peek(s, i);
                i[0]++;
                if (d == '}') return m;
                if (d != ',') throw new IllegalArgumentException("Bad JSON");
            }
        }
        if (c == '[') {
            i[0]++;
            List<Object> l = new ArrayList<>();
            skip(s, i);
            if (peek(s, i) == ']') { i[0]++; return l; }
            while (true) {
                skip(s, i);
                l.add(value(s, i, depth + 1));
                skip(s, i);
                char d = peek(s, i);
                i[0]++;
                if (d == ']') return l;
                if (d != ',') throw new IllegalArgumentException("Bad JSON");
            }
        }
        if (c == '"') return readString(s, i);
        if (s.startsWith("true", i[0])) { i[0] += 4; return Boolean.TRUE; }
        if (s.startsWith("false", i[0])) { i[0] += 5; return Boolean.FALSE; }
        if (s.startsWith("null", i[0])) { i[0] += 4; return null; }
        return number(s, i);
    }

    private static Object number(String s, int[] i) {
        int start = i[0];
        while (i[0] < s.length() && "+-0123456789.eE".indexOf(s.charAt(i[0])) >= 0) i[0]++;
        String t = s.substring(start, i[0]);
        if (t.isEmpty()) throw new IllegalArgumentException("Bad JSON");
        try {
            if (t.matches("-?\\d{1,18}")) return Long.parseLong(t);
            return Double.parseDouble(t);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("Bad number");
        }
    }

    private static char peek(String s, int[] i) {
        if (i[0] >= s.length()) throw new IllegalArgumentException("Bad JSON");
        return s.charAt(i[0]);
    }

    private static void skip(String s, int[] i) {
        while (i[0] < s.length() && Character.isWhitespace(s.charAt(i[0]))) i[0]++;
    }

    private static void expect(String s, int[] i, char c) {
        if (peek(s, i) != c) throw new IllegalArgumentException("Bad JSON");
        i[0]++;
    }

    private static String readString(String s, int[] i) {
        expect(s, i, '"');
        StringBuilder b = new StringBuilder();
        while (true) {
            char c = peek(s, i);
            i[0]++;
            if (c == '"') return b.toString();
            if (c == '\\') {
                char e = peek(s, i);
                i[0]++;
                switch (e) {
                    case 'n': b.append('\n'); break;
                    case 't': b.append('\t'); break;
                    case 'r': b.append('\r'); break;
                    case 'b': b.append('\b'); break;
                    case 'f': b.append('\f'); break;
                    case 'u':
                        if (i[0] + 4 > s.length()) throw new IllegalArgumentException("Bad JSON");
                        b.append((char) Integer.parseInt(s.substring(i[0], i[0] + 4), 16));
                        i[0] += 4;
                        break;
                    default: b.append(e);
                }
            } else {
                b.append(c);
            }
        }
    }
}
