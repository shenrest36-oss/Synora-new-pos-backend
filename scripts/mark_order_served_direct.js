const prisma = require('../src/prismaClient');

async function main() {
  try {
    const id = 4;
    console.log(`Marking pos_order ${id} as ready (direct DB update)`);
    const updated = await prisma.posOrder.update({
      where: { id },
      data: { kitchenStatus: 'ready', readyAt: new Date() },
    });
    console.log('Updated:', updated);
  } catch (err) {
    console.error('Error updating order:', err.message);
    process.exit(2);
  } finally {
    await prisma.$disconnect();
  }
}

main();
