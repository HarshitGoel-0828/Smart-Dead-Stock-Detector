import java.io.FileInputStream;
import java.io.IOException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Properties;

/** Step 1 of the backend: proves that Java can talk to MySQL. Run it before writing anything else. */
public class DbCheck {
    public static void main(String[] args) {
        Properties cfg = new Properties();
        try (FileInputStream in = new FileInputStream("config.properties")) {
            cfg.load(in);
        } catch (IOException e) {
            System.out.println("Could not read backend/config.properties. Copy config.properties.example to config.properties and fill in your MySQL password.");
            return;
        }
        try (Connection c = DriverManager.getConnection(cfg.getProperty("db.url"), cfg.getProperty("db.user"), cfg.getProperty("db.password"));
             Statement st = c.createStatement();
             ResultSet rs = st.executeQuery("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME")) {
            System.out.println("Connected to MySQL OK. Tables found:");
            int n = 0;
            while (rs.next()) {
                System.out.println("  - " + rs.getString(1));
                n++;
            }
            System.out.println(n + " table(s). " + (n == 6 ? "Everything is ready." : "Expected 6 - re-run database/schema.sql."));
        } catch (SQLException e) {
            System.out.println("Connection failed: " + e.getMessage());
            System.out.println("Check: MySQL80 service running, password in config.properties, and the mysql-connector-j jar inside backend/lib.");
        }
    }
}