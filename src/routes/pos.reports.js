const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');

// GET /api/pos/reports/sales-summary?date=2026-09-02&outlet_id=
router.get('/sales-summary', authenticate, async (req, res) => {
  try {
    const { date, outlet_id } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(targetDate); end.setHours(23, 59, 59, 999);

    const whereOrder = { openedAt: { gte: start, lte: end }, status: { in: ['paid'] } };
    if (outlet_id) whereOrder.outletId = Number(outlet_id);

    const orders = await prisma.posOrder.findMany({
      where: whereOrder,
      include: {
        bills: {
          where: { status: 'paid' },
          include: { payments: true, taxes: true },
        },
        outlet: { select: { name: true } },
      },
    });

    const summary = {
      date: targetDate.toISOString().slice(0, 10),
      totalOrders: orders.length,
      subtotal: 0,
      taxTotal: 0,
      discountTotal: 0,
      grandTotal: 0,
      byPaymentMethod: {},
      byOutlet: {},
    };

    for (const order of orders) {
      for (const bill of order.bills) {
        summary.subtotal      += Number(bill.subtotal);
        summary.taxTotal      += Number(bill.taxTotal);
        summary.discountTotal += Number(bill.discountTotal);
        summary.grandTotal    += Number(bill.grandTotal);

        for (const p of bill.payments) {
          summary.byPaymentMethod[p.method] = (summary.byPaymentMethod[p.method] || 0) + Number(p.amount);
        }
      }

      const outletName = order.outlet?.name || 'Unknown';
      if (!summary.byOutlet[outletName]) summary.byOutlet[outletName] = { orders: 0, grandTotal: 0 };
      summary.byOutlet[outletName].orders++;
      summary.byOutlet[outletName].grandTotal += order.bills.reduce((s, b) => s + Number(b.grandTotal), 0);
    }

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/reports/void-log?date=&outlet_id=
router.get('/void-log', authenticate, async (req, res) => {
  try {
    const { date, outlet_id } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(targetDate); end.setHours(23, 59, 59, 999);

    const voids = await prisma.posItemVoid.findMany({
      where: { voidedAt: { gte: start, lte: end } },
      include: {
        orderItem: { include: { menuItem: true, order: { include: { outlet: true, table: true } } } },
        voidReason: true,
      },
      orderBy: { voidedAt: 'desc' },
    });

    const filtered = outlet_id
      ? voids.filter(v => v.orderItem?.order?.outletId === Number(outlet_id))
      : voids;

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/reports/meal-period-summary?date=
router.get('/meal-period-summary', authenticate, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(targetDate); end.setHours(23, 59, 59, 999);

    const orders = await prisma.posOrder.findMany({
      where: { openedAt: { gte: start, lte: end }, status: 'paid' },
      include: { mealPeriod: true, bills: { where: { status: 'paid' } } },
    });

    const byPeriod = {};
    for (const order of orders) {
      const key = order.mealPeriod?.name || 'No Period';
      if (!byPeriod[key]) byPeriod[key] = { orders: 0, grandTotal: 0 };
      byPeriod[key].orders++;
      byPeriod[key].grandTotal += order.bills.reduce((s, b) => s + Number(b.grandTotal), 0);
    }

    res.json(byPeriod);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/reports/payment-breakdown?date=
router.get('/payment-breakdown', authenticate, async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate); start.setHours(0, 0, 0, 0);
    const end   = new Date(targetDate); end.setHours(23, 59, 59, 999);

    const payments = await prisma.posPayment.findMany({
      where: { paidAt: { gte: start, lte: end }, isVoid: false },
      include: { bill: { include: { order: { include: { outlet: true } } } } },
      orderBy: { paidAt: 'asc' },
    });

    const breakdown = {};
    for (const p of payments) {
      breakdown[p.method] = (breakdown[p.method] || 0) + Number(p.amount);
    }

    res.json({ date: targetDate.toISOString().slice(0, 10), breakdown, payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
