CREATE DATABASE IF NOT EXISTS dead_stock_detector
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE dead_stock_detector;

CREATE TABLE IF NOT EXISTS users (
  user_id       INT AUTO_INCREMENT PRIMARY KEY,
  shop_name     VARCHAR(80)  NOT NULL,
  username      VARCHAR(40)  NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS products (
  product_id    VARCHAR(40)   PRIMARY KEY,
  user_id       INT           NOT NULL,
  name          VARCHAR(80)   NOT NULL,
  category      VARCHAR(60)   NOT NULL DEFAULT 'General',
  stock_qty     INT           NOT NULL,
  cost_per_unit DECIMAL(10,2) NOT NULL,
  date_added    DATE          NOT NULL,
  CONSTRAINT chk_stock CHECK (stock_qty >= 0),
  CONSTRAINT chk_cost  CHECK (cost_per_unit >= 0),
  CONSTRAINT fk_products_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  UNIQUE KEY uq_product (user_id, name, category)
);

CREATE TABLE IF NOT EXISTS sales_records (
  sale_id     VARCHAR(40) PRIMARY KEY,
  user_id     INT         NOT NULL,
  product_id  VARCHAR(40) NOT NULL,
  units_sold  INT         NOT NULL,
  sale_date   DATE        NOT NULL,
  CONSTRAINT chk_units CHECK (units_sold >= 0),
  CONSTRAINT fk_sales_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_sales_product FOREIGN KEY (product_id)
    REFERENCES products(product_id) ON DELETE CASCADE,
  INDEX idx_sales_product_date (product_id, sale_date)
);

CREATE TABLE IF NOT EXISTS threshold_settings (
  user_id            INT PRIMARY KEY,
  fast_threshold     INT NOT NULL DEFAULT 40,
  dead_threshold     INT NOT NULL DEFAULT 5,
  low_stock          INT NOT NULL DEFAULT 5,
  tracking_days      INT NOT NULL DEFAULT 30,
  category_overrides JSON NULL,
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS history_snapshots (
  snapshot_id    BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT           NOT NULL,
  product_id     VARCHAR(40)   NOT NULL,
  product_name   VARCHAR(80)   NOT NULL,
  ts_ms          BIGINT        NOT NULL,
  str_percent    DECIMAL(6,2)  NOT NULL,
  locked_capital DECIMAL(12,2) NOT NULL,
  risk_score     INT           NOT NULL,
  status         ENUM('FAST','SLOW','DEAD') NOT NULL,
  CONSTRAINT fk_hist_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_hist_user_ts (user_id, ts_ms)
);

CREATE TABLE IF NOT EXISTS activity_log (
  log_id      BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT          NOT NULL,
  action      VARCHAR(40)  NOT NULL,
  details     VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_log_user FOREIGN KEY (user_id)
    REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_log_user_time (user_id, created_at)
);