import java.util.HashMap;
import java.util.Map;

/** Tiny JSON helper: reads a flat object like {"a":"b","c":"d"} (string values only) and escapes text for output. */
public class Json {
    public static Map<String, String> parseFlat(String s) {
        Map<String, String> out = new HashMap<>();
        int[] i = {0};
        skip(s, i);
        expect(s, i, '{');
        skip(s, i);
        if (peek(s, i) == '}') return out;
        while (true) {
            skip(s, i);
            String key = readString(s, i);
            skip(s, i);
            expect(s, i, ':');
            skip(s, i);
            if (peek(s, i) != '"') throw new IllegalArgumentException("Only text values are allowed");
            out.put(key, readString(s, i));
            skip(s, i);
            char c = peek(s, i);
            i[0]++;
            if (c == '}') break;
            if (c != ',') throw new IllegalArgumentException("Bad JSON");
        }
        return out;
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