import java.sql.SQLException;
import java.util.List;
import java.util.Map;

/** What the server needs from the database. MySqlStore is the real one. */
public interface DataStore {
    List<Map<String, Object>> products(int userId) throws SQLException;
    void saveProducts(int userId, List<Map<String, Object>> list) throws SQLException;

    List<Map<String, Object>> sales(int userId) throws SQLException;
    void saveSales(int userId, List<Map<String, Object>> list) throws SQLException;

    List<Map<String, Object>> history(int userId) throws SQLException;
    void saveHistory(int userId, List<Map<String, Object>> list) throws SQLException;

    /** Returns null when the shop has never saved settings. */
    Map<String, Object> settings(int userId) throws SQLException;
    void saveSettings(int userId, Map<String, Object> settings) throws SQLException;

    /** Adds one line to the activity log. */
    void log(int userId, String action, String details) throws SQLException;
    /** Newest first. Each entry has action, details and at (date and time). */
    List<Map<String, Object>> activity(int userId, int limit) throws SQLException;

    /** Returns { shopName, passwordHash }, or null if there is no such user. */
    String[] userById(int userId) throws SQLException;
    void updatePassword(int userId, String newHash) throws SQLException;
}
