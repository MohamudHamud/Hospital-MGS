// 002: double-entry accounting — chart of accounts, journal entries/lines,
// extra columns on expenses/payments, and a one-time backfill of existing records.
// Idempotent: safe on databases that were upgraded before migrations existed.
const accounting = require('../src/services/accounting');

module.exports.up = async (c) => {
  await accounting.ensure(c);
};
