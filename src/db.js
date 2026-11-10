const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'hospital_mgs',
  waitForConnections: true,
  connectionLimit: 15,
  dateStrings: true,
  decimalNumbers: true,
});

async function query(sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows;
}
async function one(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// Run fn inside a transaction. fn receives { query, one } bound to the connection.
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const q = async (sql, params) => (await conn.query(sql, params))[0];
    const c = { query: q, one: async (sql, params) => (await q(sql, params))[0] || null };
    const result = await fn(c);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, one, tx };
