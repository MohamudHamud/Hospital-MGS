-- Run once as MySQL root to create a dedicated application user (do not run the app as root).
--   mysql -u root -p < deploy/create-db-user.sql
-- Change the password below first, and put the same values in .env (DB_USER / DB_PASSWORD).
CREATE DATABASE IF NOT EXISTS hospital_mgs CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'hms_app'@'localhost' IDENTIFIED BY 'CHANGE_THIS_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON hospital_mgs.* TO 'hms_app'@'localhost';
FLUSH PRIVILEGES;
