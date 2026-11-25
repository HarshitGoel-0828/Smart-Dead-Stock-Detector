import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLIntegrityConstraintViolationException;
import java.sql.Statement;

/** All SQL for the users table. */
public class UserDao {
    public static class User {
        public final int id;
        public final String shopName;
        public final String passwordHash;

        User(int id, String shopName, String passwordHash) {
            this.id = id;
            this.shopName = shopName;
            this.passwordHash = passwordHash;
        }
    }

    /** Inserts a user and returns the new id, or -1 if the username is already taken. */
    public static int create(String shopName, String username, String passwordHash) throws SQLException {
        String sql = "INSERT INTO users (shop_name, username, password_hash) VALUES (?, ?, ?)";
        try (Connection c = Db.get();
             PreparedStatement ps = c.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, shopName);
            ps.setString(2, username);
            ps.setString(3, passwordHash);
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                keys.next();
                return keys.getInt(1);
            }
        } catch (SQLIntegrityConstraintViolationException dup) {
            return -1;
        }
    }

    /** Returns the user, or null if there is no such username. */
    public static User find(String username) throws SQLException {
        String sql = "SELECT user_id, shop_name, password_hash FROM users WHERE username = ?";
        try (Connection c = Db.get(); PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, username);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? new User(rs.getInt(1), rs.getString(2), rs.getString(3)) : null;
            }
        }
    }
}