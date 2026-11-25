import java.util.*;
public class MemStore implements DataStore {
    Map<Integer, List<Map<String,Object>>> p = new HashMap<>(), s = new HashMap<>(), h = new HashMap<>();
    Map<Integer, Map<String,Object>> set = new HashMap<>();
    public List<Map<String,Object>> products(int u){ return p.getOrDefault(u, new ArrayList<>()); }
    public void saveProducts(int u, List<Map<String,Object>> l){ p.put(u,l); }
    public List<Map<String,Object>> sales(int u){ return s.getOrDefault(u, new ArrayList<>()); }
    public void saveSales(int u, List<Map<String,Object>> l){ s.put(u,l); }
    public List<Map<String,Object>> history(int u){ return h.getOrDefault(u, new ArrayList<>()); }
    public void saveHistory(int u, List<Map<String,Object>> l){ h.put(u,l); }
    public Map<String,Object> settings(int u){ return set.get(u); }
    public void saveSettings(int u, Map<String,Object> m){ set.put(u,m); }
}
