import java.util.*;
public class MemStore implements DataStore {
    Map<Integer, List<Map<String,Object>>> p = new HashMap<>(), s = new HashMap<>(), h = new HashMap<>(), logs = new HashMap<>();
    Map<Integer, Map<String,Object>> set = new HashMap<>();
    Map<Integer, String[]> users = new HashMap<>();
    public MemStore() { users.put(1, new String[] { "Test Shop", Auth.hashPassword("oldpass1") }); }
    public List<Map<String,Object>> products(int u){ return p.getOrDefault(u, new ArrayList<>()); }
    public void saveProducts(int u, List<Map<String,Object>> l){ p.put(u,l); }
    public List<Map<String,Object>> sales(int u){ return s.getOrDefault(u, new ArrayList<>()); }
    public void saveSales(int u, List<Map<String,Object>> l){ s.put(u,l); }
    public List<Map<String,Object>> history(int u){ return h.getOrDefault(u, new ArrayList<>()); }
    public void saveHistory(int u, List<Map<String,Object>> l){ h.put(u,l); }
    public Map<String,Object> settings(int u){ return set.get(u); }
    public void saveSettings(int u, Map<String,Object> m){ set.put(u,m); }
    public void log(int u, String a, String d){ Map<String,Object> e = new LinkedHashMap<>(); e.put("action",a); e.put("details",d); e.put("at","2026-11-25 10:00:00"); logs.computeIfAbsent(u, k -> new ArrayList<>()).add(0, e); }
    public List<Map<String,Object>> activity(int u, int limit){ List<Map<String,Object>> l = logs.getOrDefault(u, new ArrayList<>()); return l.subList(0, Math.min(limit, l.size())); }
    public String[] userById(int u){ return users.get(u); }
    public void updatePassword(int u, String hash){ users.get(u)[1] = hash; }
}
