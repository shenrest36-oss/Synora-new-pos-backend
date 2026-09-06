const prisma = require('../prismaClient');

/**
 * billService.js
 * Generates a unique bill number in the format POS-YYYYMMDD-XXXX
 */
async function generateBillNo() {
  const today = new Date();
  const datePart = today.toISOString().slice(0, 10).replace(/-/g, '');

  // Count bills today to get sequence
  const startOfDay = new Date(today); startOfDay.setHours(0, 0, 0, 0);
  const count = await prisma.posBill.count({ where: { createdAt: { gte: startOfDay } } });
  const seq = String(count + 1).padStart(4, '0');

  return `POS-${datePart}-${seq}`;
}

module.exports = { generateBillNo };
