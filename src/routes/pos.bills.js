const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');
const { generateBillNo } = require('../services/billService');
const { calculateItemTaxes } = require('../services/taxService');

// POST /api/pos/bills/:orderId   — generate bill from order
router.post('/:orderId', authenticate, async (req, res) => {
  try {
    const orderId = Number(req.params.orderId);
    const order = await prisma.posOrder.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: {
            menuItem: { include: { taxClass: { include: { taxes: { include: { tax: true } } } } } },
            taxes: true,
            voids: true,
          },
        },
        discounts: true,
      },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'paid') return res.status(400).json({ error: 'Order already billed and paid' });

    // Filter out fully-voided items
    const activeItems = order.items.filter(i => {
      const voidedQty = i.voids.reduce((s, v) => s + v.qty, 0);
      return Number(i.qty) > voidedQty;
    });

    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;
    const billItemsData = [];
    const billTaxesMap = {};

    for (const item of activeItems) {
      const voidedQty = item.voids.reduce((s, v) => s + v.qty, 0);
      const effectiveQty = Number(item.qty) - voidedQty;
      const lineSubtotal = Number(item.unitPrice) * effectiveQty;
      subtotal += lineSubtotal;

      for (const t of item.taxes) {
        const taxAmt = (Number(t.taxAmount) / Number(item.qty)) * effectiveQty;
        taxTotal += taxAmt;
        billTaxesMap[t.taxId] = (billTaxesMap[t.taxId] || 0) + taxAmt;
      }

      billItemsData.push({ orderItemId: item.id, qty: effectiveQty });
    }

    // Apply order-level discounts
    const discountTotal = order.discounts.reduce((s, d) => {
      return s + (d.valueType === 'percentage' ? subtotal * (Number(d.value) / 100) : Number(d.value));
    }, 0);

    const grandTotal = subtotal + taxTotal - discountTotal;
    // Attempt the create inside a retry loop to handle rare race conditions
    // where generateBillNo() can produce the same bill number under concurrency.
    // Retry on unique-constraint violations (Prisma code P2002) for bill_no.
    let bill = null;
    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const billNo = await generateBillNo();
      try {
        bill = await prisma.$transaction(async (tx) => {
          const b = await tx.posBill.create({
            data: {
              orderId,
              billNo,
              subtotal,
              taxTotal,
              discountTotal,
              grandTotal,
              createdBy: req.user.id,
              items: { create: billItemsData },
              taxes: {
                create: Object.entries(billTaxesMap).map(([taxId, taxAmount]) => ({
                  taxId: Number(taxId),
                  taxAmount,
                })),
              },
            },
            include: { items: true, taxes: true, payments: true },
          });

          await tx.posOrder.update({ where: { id: orderId }, data: { status: 'billed' } });
          return b;
        });

        // success — break out
        break;
      } catch (err) {
        // Prisma unique constraint error code is P2002
        // If it's a bill_no conflict, retry a few times. Otherwise rethrow.
        if (err && err.code === 'P2002' && err.meta && err.meta.target && err.meta.target.includes('bill_no') && attempt < maxAttempts) {
          // small backoff before retrying
          await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
          continue;
        }
        throw err;
      }
    }

    if (!bill) {
      // Shouldn't happen, but guard just in case
      return res.status(500).json({ error: 'Failed to create bill after multiple attempts' });
    }

    res.status(201).json(bill);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/bills/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const bill = await prisma.posBill.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        order: {
          include: {
            table: true,
            waiter: true,
            items: { include: { menuItem: true, voids: true } },
          },
        },
        items: { include: { orderItem: { include: { menuItem: true } } } },
        taxes: true,
        discounts: true,
        payments: true,
      },
    });
    if (!bill) return res.status(404).json({ error: 'Bill not found' });

    const taxIds = [...new Set(bill.taxes.map((taxLine) => taxLine.taxId))];
    const taxRows = taxIds.length
      ? await prisma.posTax.findMany({ where: { id: { in: taxIds } } })
      : [];
    const taxMap = Object.fromEntries(taxRows.map((tax) => [tax.id, tax]));

    const billWithTaxDetails = {
      ...bill,
      taxes: bill.taxes.map((taxLine) => ({
        ...taxLine,
        tax: taxMap[taxLine.taxId] || null,
      })),
    };

    res.json(billWithTaxDetails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/bills/:id/discount
// body: { valueType: 'percentage'|'fixed', value, remark? }
router.post('/:id/discount', authenticate, async (req, res) => {
  try {
    const { valueType, value, remark } = req.body;
    if (!valueType || value == null) return res.status(400).json({ error: 'valueType and value are required' });

    const bill = await prisma.posBill.findUnique({ where: { id: Number(req.params.id) } });
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    if (bill.status !== 'open') return res.status(400).json({ error: 'Can only discount an open bill' });

    const discountAmount = valueType === 'percentage'
      ? Number(bill.subtotal) * (Number(value) / 100)
      : Number(value);

    const [discount, updatedBill] = await prisma.$transaction([
      prisma.posBillDiscount.create({
        data: { billId: Number(req.params.id), valueType, value, discountAmount, remark, appliedBy: req.user.id },
      }),
      prisma.posBill.update({
        where: { id: Number(req.params.id) },
        data: {
          discountTotal: { increment: discountAmount },
          grandTotal: { decrement: discountAmount },
        },
      }),
    ]);

    res.status(201).json({ discount, bill: updatedBill });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
