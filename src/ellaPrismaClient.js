const { PrismaClient } = require('@prisma/client');

/**
 * Separate Prisma client pointed at ella_pms.
 * Used ONLY for room posting — reads reservations, inserts guest_charges.
 * The main prismaClient.js points at kot_bot (POS tables).
 */
const ellaPrisma = new PrismaClient({
  datasources: { db: { url: process.env.ELLA_PMS_DATABASE_URL } },
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

module.exports = ellaPrisma;
