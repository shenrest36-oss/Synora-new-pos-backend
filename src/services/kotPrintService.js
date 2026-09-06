const prisma = require('../prismaClient');

/**
 * kotPrintService.js
 *
 * Logs KOT/BOT prints to pos_print_logs.
 * Phase 1: logging only.
 * Phase 1.5: add WebSocket broadcast to KitchenDisplay or ESC/POS thermal print.
 */

let printSequence = {};

async function triggerKotPrint(orderId, orderItemId, printerStationId, userId) {
  if (!printerStationId) return; // No printer assigned — skip

  const nightDate = new Date();
  nightDate.setHours(0, 0, 0, 0);

  // Increment print sequence per station per day
  const key = `${printerStationId}-${nightDate.toISOString().slice(0, 10)}`;
  if (!printSequence[key]) {
    // Get last print number for this station today
    const last = await prisma.posPrintLog.findFirst({
      where: { printerStationId, nightDate },
      orderBy: { printNo: 'desc' },
      select: { printNo: true },
    });
    printSequence[key] = (last?.printNo || 0);
  }
  printSequence[key]++;

  await prisma.posPrintLog.create({
    data: {
      orderId,
      printerStationId,
      printNo: printSequence[key],
      nightDate,
      printedBy: userId,
    },
  });

  // TODO Phase 1.5: emit WebSocket event for KitchenDisplay
  // io.to(`station-${printerStationId}`).emit('new-kot', { orderId, orderItemId, printNo: printSequence[key] });
}

module.exports = { triggerKotPrint };
