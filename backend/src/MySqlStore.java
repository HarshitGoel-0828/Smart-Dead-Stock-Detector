import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.Connection;
import java.sql.Date;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** All SQL for products, sales, history and settings. Every query is limited to one user_id. */
public class MySqlStore implements DataStore {

    private interface Work { void run(Connection c) throws SQLException; }

    /** Runs the work in one transaction: all of it is saved, or none of it. */
    private static void tx(Work w) throws SQLException {
        try (Connection c = Db.get()) {
            c.setAutoCommit(false);
            try {
                w.run(c);
                c.commit();
            } catch (SQLException e) {
                c.rollback();
                // a batch can report a duplicate/foreign-key problem as a plain SQLException (SQLSTATE 23xxx)
                if (!(e instanceof SQLIntegrityConstraintViolationException) && e.getSQLState() != null && e.getSQLState().startsWith("23")) {
                    throw new SQLIntegrityConstraintViolationException(e.getMessage(), e.getSQLState(), e.getErrorCode(), e);
                }
                throw e;
            } catch (RuntimeException e) {
                c.rollback();
                throw e;
            }
        }
    }

    private static BigDecimal money(Object o) {
        return BigDecimal.valueOf(((Number) o).doubleValue()).setScale(2, RoundingMode.HALF_UP);
    }

    private static Set<String> idSet(Connection c, String sql, int userId) throws SQLException {
        Set<String> out = new HashSet<>();
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) out.add(rs.getString(1));
            }
        }
        return out;
    }

    private static boolean exists(Connection c, String sql, String id) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, id);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    // ---------------- products ----------------
    @Override
    public List<Map<String, Object>> products(int userId) throws SQLException {
        String sql = "SELECT product_id, name, category, stock_qty, cost_per_unit, date_added FROM products WHERE user_id = ? ORDER BY name";
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = Db.get(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> p = new LinkedHashMap<>();
                    p.put("id", rs.getString(1));
                    p.put("name", rs.getString(2));
                    p.put("category", rs.getString(3));
                    p.put("stock", rs.getLong(4));
                    p.put("cost", rs.getBigDecimal(5).doubleValue());
                    p.put("added", rs.getDate(6).toString());
                    out.add(p);
                }
            }
        }
        return out;
    }

    @Override
    public void saveProducts(int userId, List<Map<String, Object>> list) throws SQLException {
        tx(c -> {
            Set<String> mine = idSet(c, "SELECT product_id FROM products WHERE user_id = ?", userId);
            Set<String> incoming = new HashSet<>();
            for (Map<String, Object> m : list) incoming.add((String) m.get("id"));
            // an id that already belongs to another shop must never be overwritten
            for (String id : incoming) {
                if (!mine.contains(id) && exists(c, "SELECT 1 FROM products WHERE product_id = ?", id)) {
                    throw new SQLIntegrityConstraintViolationException("That product id is already in use");
                }
            }
            try (PreparedStatement del = c.prepareStatement("DELETE FROM products WHERE user_id = ? AND product_id = ?")) {
                for (String id : mine) {
                    if (!incoming.contains(id)) {
                        del.setInt(1, userId);
                        del.setString(2, id);
                        del.addBatch();
                    }
                }
                del.executeBatch(); // deleting a product also deletes its sales (ON DELETE CASCADE)
            }
            String up = "INSERT INTO products (product_id, user_id, name, category, stock_qty, cost_per_unit, date_added) VALUES (?,?,?,?,?,?,?) "
                + "ON DUPLICATE KEY UPDATE name = VALUES(name), category = VALUES(category), stock_qty = VALUES(stock_qty), "
                + "cost_per_unit = VALUES(cost_per_unit), date_added = VALUES(date_added)";
            try (PreparedStatement ps = c.prepareStatement(up)) {
                for (Map<String, Object> m : list) {
                    ps.setString(1, (String) m.get("id"));
                    ps.setInt(2, userId);
                    ps.setString(3, (String) m.get("name"));
                    ps.setString(4, (String) m.get("category"));
                    ps.setInt(5, ((Number) m.get("stock")).intValue());
                    ps.setBigDecimal(6, money(m.get("cost")));
                    ps.setDate(7, Date.valueOf((String) m.get("added")));
                    ps.addBatch();
                }
                ps.executeBatch();
            }
        });
    }

    // ---------------- sales ----------------
    @Override
    public List<Map<String, Object>> sales(int userId) throws SQLException {
        String sql = "SELECT sale_id, product_id, units_sold, sale_date FROM sales_records WHERE user_id = ? ORDER BY sale_date, sale_id";
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = Db.get(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> s = new LinkedHashMap<>();
                    s.put("id", rs.getString(1));
                    s.put("productId", rs.getString(2));
                    s.put("qty", rs.getLong(3));
                    s.put("date", rs.getDate(4).toString());
                    out.add(s);
                }
            }
        }
        return out;
    }

    @Override
    public void saveSales(int userId, List<Map<String, Object>> list) throws SQLException {
        tx(c -> {
            Set<String> mine = idSet(c, "SELECT sale_id FROM sales_records WHERE user_id = ?", userId);
            Set<String> incoming = new HashSet<>();
            for (Map<String, Object> m : list) incoming.add((String) m.get("id"));
            for (String id : incoming) {
                if (!mine.contains(id) && exists(c, "SELECT 1 FROM sales_records WHERE sale_id = ?", id)) {
                    throw new SQLIntegrityConstraintViolationException("That sale id is already in use");
                }
            }
            try (PreparedStatement del = c.prepareStatement("DELETE FROM sales_records WHERE user_id = ? AND sale_id = ?")) {
                for (String id : mine) {
                    if (!incoming.contains(id)) {
                        del.setInt(1, userId);
                        del.setString(2, id);
                        del.addBatch();
                    }
                }
                del.executeBatch();
            }
            String up = "INSERT INTO sales_records (sale_id, user_id, product_id, units_sold, sale_date) VALUES (?,?,?,?,?) "
                + "ON DUPLICATE KEY UPDATE product_id = VALUES(product_id), units_sold = VALUES(units_sold), sale_date = VALUES(sale_date)";
            try (PreparedStatement ps = c.prepareStatement(up)) {
                for (Map<String, Object> m : list) {
                    ps.setString(1, (String) m.get("id"));
                    ps.setInt(2, userId);
                    ps.setString(3, (String) m.get("productId"));
                    ps.setInt(4, ((Number) m.get("qty")).intValue());
                    ps.setDate(5, Date.valueOf((String) m.get("date")));
                    ps.addBatch();
                }
                ps.executeBatch();
            }
        });
    }

    // ---------------- history ----------------
    @Override
    public List<Map<String, Object>> history(int userId) throws SQLException {
        String sql = "SELECT ts_ms, product_id, product_name, str_percent, locked_capital, risk_score, status FROM history_snapshots WHERE user_id = ? ORDER BY ts_ms, snapshot_id";
        List<Map<String, Object>> out = new ArrayList<>();
        try (Connection c = Db.get(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) {
                    Map<String, Object> h = new LinkedHashMap<>();
                    h.put("ts", rs.getLong(1));
                    h.put("productId", rs.getString(2));
                    h.put("name", rs.getString(3));
                    h.put("str", rs.getBigDecimal(4).doubleValue());
                    h.put("locked", rs.getBigDecimal(5).doubleValue());
                    h.put("risk", rs.getLong(6));
                    h.put("status", rs.getString(7));
                    out.add(h);
                }
            }
        }
        return out;
    }

    @Override
    public void saveHistory(int userId, List<Map<String, Object>> list) throws SQLException {
        tx(c -> {
            try (PreparedStatement del = c.prepareStatement("DELETE FROM history_snapshots WHERE user_id = ?")) {
                del.setInt(1, userId);
                del.executeUpdate();
            }
            String ins = "INSERT INTO history_snapshots (user_id, product_id, product_name, ts_ms, str_percent, locked_capital, risk_score, status) VALUES (?,?,?,?,?,?,?,?)";
            try (PreparedStatement ps = c.prepareStatement(ins)) {
                for (Map<String, Object> m : list) {
                    ps.setInt(1, userId);
                    ps.setString(2, (String) m.get("productId"));
                    ps.setString(3, (String) m.get("name"));
                    ps.setLong(4, ((Number) m.get("ts")).longValue());
                    ps.setBigDecimal(5, money(m.get("str")));
                    ps.setBigDecimal(6, money(m.get("locked")));
                    ps.setInt(7, ((Number) m.get("risk")).intValue());
                    ps.setString(8, (String) m.get("status"));
                    ps.addBatch();
                }
                ps.executeBatch();
            }
        });
    }

    // ---------------- settings ----------------
    @Override
    public Map<String, Object> settings(int userId) throws SQLException {
        String sql = "SELECT fast_threshold, dead_threshold, low_stock, tracking_days, category_overrides FROM threshold_settings WHERE user_id = ?";
        try (Connection c = Db.get(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            try (ResultSet rs = ps.executeQuery()) {
                if (!rs.next()) return null;
                Map<String, Object> s = new LinkedHashMap<>();
                s.put("fast", rs.getLong(1));
                s.put("dead", rs.getLong(2));
                s.put("lowStock", rs.getLong(3));
                s.put("period", rs.getLong(4));
                String raw = rs.getString(5);
                Object cats = raw == null ? new LinkedHashMap<String, Object>() : Json.parse(raw);
                s.put("cats", cats);
                return s;
            }
        }
    }

    @Override
    public void saveSettings(int userId, Map<String, Object> s) throws SQLException {
        String sql = "INSERT INTO threshold_settings (user_id, fast_threshold, dead_threshold, low_stock, tracking_days, category_overrides) VALUES (?,?,?,?,?,?) "
            + "ON DUPLICATE KEY UPDATE fast_threshold = VALUES(fast_threshold), dead_threshold = VALUES(dead_threshold), "
            + "low_stock = VALUES(low_stock), tracking_days = VALUES(tracking_days), category_overrides = VALUES(category_overrides)";
        try (Connection c = Db.get(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setInt(1, userId);
            ps.setInt(2, ((Number) s.get("fast")).intValue());
            ps.setInt(3, ((Number) s.get("dead")).intValue());
            ps.setInt(4, ((Number) s.get("lowStock")).intValue());
            ps.setInt(5, ((Number) s.get("period")).intValue());
            ps.setString(6, Json.write(s.get("cats")));
            ps.executeUpdate();
        }
    }
}
