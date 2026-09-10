const prisma = require('../src/prismaClient');

async function main() {
  try {
    const id = 4;
    console.log(`Applying raw SQL: mark pos_orders.${id} as ready`);
    await prisma.$executeRawUnsafe(`UPDATE pos_orders SET kitchen_status = 'ready', ready_at = NOW() WHERE id = ${id};`);
    const rows = await prisma.$queryRawUnsafe(`SELECT id, kitchen_status, started_at, ready_at FROM pos_orders WHERE id = ${id} LIMIT 1;`);
    console.log('Row after update:', rows[0]);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(2);
  } finally {
    await prisma.$disconnect();
  }
}

main();
