const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');
const { postToRoomFolio } = require('../services/roomPostingService');

// POST /api/pos/payments/:billId
// body: { method, amount, ...methodSpecificFields }
router.post('/:billId', authenticate, async (req, res) => {
  try {
    const billId = Number(req.params.billId);
    const {
      method, amount,
      // card
      cardNo, authNo, bankName,
      // city ledger
      cityLedgerAccount,
      // room posting
      reservationId, roomNumber, guestName,
      // cash
      currencyRate,
    } = req.body;

    if (!method || amount == null) return res.status(400).json({ error: 'method and amount are required' });

    const allowed = ['cash', 'card', 'city_ledger', 'room_posting', 'complimentary'];
    if (!allowed.includes(method)) return res.status(400).json({ error: `method must be one of: ${allowed.join(', ')}` });

    const bill = await prisma.posBill.findUnique({
      where: { id: billId },
      include: { payments: true },
    });
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.status === 'paid') return res.status(400).json({ error: 'Bill already paid' });

    let guestChargeId = null;

    // For room posting — create guest_charge in ella_pms FIRST
    if (method === 'room_posting') {
      if (!reservationId) return res.status(400).json({ error: 'reservationId is required for room_posting' });
      guestChargeId = await postToRoomFolio({
        reservationId: Number(reservationId),
        amount: Number(amount),
        billNo: bill.billNo,
        description: `Restaurant — Bill #${bill.billNo}`,
        postedBy: req.user.id,
      });
    }

    // Total paid so far
    const alreadyPaid = bill.payments.reduce((s, p) => s + Number(p.amount), 0);
    const newTotal = alreadyPaid + Number(amount);
    const isFullyPaid = newTotal >= Number(bill.grandTotal);

    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.posPayment.create({
        data: {
          billId,
          method,
          amount: Number(amount),
          currencyRate: currencyRate ? Number(currencyRate) : null,
          cardNo, authNo, bankName,
          cityLedgerAccount,
          reservationId: reservationId ? Number(reservationId) : null,
          roomNumber, guestName,
          guestChargeId,
          paidBy: req.user.id,
        },
      });

      if (isFullyPaid) {
        await tx.posBill.update({ where: { id: billId }, data: { status: 'paid', paidAt: new Date() } });
        await tx.posOrder.update({ where: { id: bill.orderId }, data: { status: 'paid', closedAt: new Date() } });
        // Free the table
        const order = await tx.posOrder.findUnique({ where: { id: bill.orderId }, select: { tableId: true } });
        if (order) await tx.posTable.update({ where: { id: order.tableId }, data: { status: 'free' } });
      }

      return p;
    });

    res.status(201).json({ payment, fullyPaid: isFullyPaid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/payments/:billId  — list payments for a bill
router.get('/:billId', authenticate, async (req, res) => {
  try {
    const payments = await prisma.posPayment.findMany({
      where: { billId: Number(req.params.billId) },
      orderBy: { paidAt: 'asc' },
    });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
