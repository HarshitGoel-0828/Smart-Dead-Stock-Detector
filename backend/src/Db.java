import java.io.FileInputStream;
import java.io.IOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;

/** Reads backend/config.properties once and hands out MySQL connections. */
public class Db {
    private static Properties cfg;

    private static synchronized Properties config() throws IOException {
        if (cfg == null) {
            Properties p = new Properties();
            try (FileInputStream in = new FileInputStream("config.properties")) {
                p.load(in);
            }
            cfg = p;
        }
        return cfg;
    }

    public static Connection get() throws SQLException {
        try {
            Properties p = config();
            return DriverManager.getConnection(p.getProperty("db.url"), p.getProperty("db.user"), p.getProperty("db.password"));
        } catch (IOException e) {
            throw new SQLException("Could not read backend/config.properties", e);
        }
    }
}