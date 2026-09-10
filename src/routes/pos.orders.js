const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');
const { calculateItemPriceBreakdown, calculateItemTaxes } = require('../services/taxService');
const { triggerKotPrint } = require('../services/kotPrintService');
const { broadcastKitchenOrder, fetchKitchenOrderSnapshot } = require('../services/kitchenStream');

// ── HELPERS ───────────────────────────────────────────────────────────────────

function assertOrder(order, res) {
  if (!order) { res.status(404).json({ error: 'Order not found' }); return false; }
  return true;
}

// ── OPEN ORDERS (list) ────────────────────────────────────────────────────────

// GET /api/pos/orders?outlet_id=&status=&table_id=
router.get('/', authenticate, async (req, res) => {
  try {
    const { outlet_id, status, table_id } = req.query;
    const where = {};
    if (outlet_id) where.outletId = Number(outlet_id);
    if (status) where.status = status;
    if (table_id) where.tableId = Number(table_id);

    const orders = await prisma.posOrder.findMany({
      where,
      include: {
        table: true,
        waiter: true,
        mealPeriod: true,
        items: {
          include: { menuItem: true, voids: true },
        },
      },
      orderBy: { openedAt: 'desc' },
    });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── OPEN NEW ORDER ────────────────────────────────────────────────────────────

// POST /api/pos/orders
// body: { tableId, outletId, waiterId?, mealPeriodId?, remark? }
router.post('/', authenticate, async (req, res) => {
  try {
    const { tableId, outletId, waiterId, mealPeriodId, remark } = req.body;
    if (!tableId || !outletId) return res.status(400).json({ error: 'tableId and outletId are required' });

    // Check no open order already exists on this table
    const existing = await prisma.posOrder.findFirst({
      where: { tableId: Number(tableId), status: { in: ['open', 'sent', 'billed'] } },
    });
    if (existing) return res.status(409).json({ error: 'Table already has an open order', orderId: existing.id });

    const [order] = await prisma.$transaction([
      prisma.posOrder.create({
        data: {
          tableId: Number(tableId),
          outletId: Number(outletId),
          waiterId: waiterId ? Number(waiterId) : null,
          mealPeriodId: mealPeriodId ? Number(mealPeriodId) : null,
          remark,
          nightDate: new Date(),
          createdBy: req.user.id,
        },
        include: { table: true, waiter: true },
      }),
      prisma.posTable.update({
        where: { id: Number(tableId) },
        data: { status: 'occupied' },
      }),
    ]);

    const snapshot = await fetchKitchenOrderSnapshot(order.id);
    broadcastKitchenOrder(snapshot);

    res.status(201).json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET SINGLE ORDER ──────────────────────────────────────────────────────────

// GET /api/pos/orders/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const order = await prisma.posOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        table: true,
        waiter: true,
        mealPeriod: true,
        outlet: true,
        items: {
          include: {
            menuItem: { include: { taxClass: { include: { taxes: { include: { tax: true } } } } } },
            taxes: { include: { tax: true } },
            voids: { include: { voidReason: true } },
          },
        },
        discounts: true,
        bills: { include: { payments: true } },
      },
    });
    if (!assertOrder(order, res)) return;
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── ADD ITEM TO ORDER (fires KOT/BOT) ────────────────────────────────────────

// POST /api/pos/orders/:id/items
// body: { menuItemId, qty, comment? }
router.post('/:id/items', authenticate, async (req, res) => {
  try {
    const { menuItemId, qty, comment } = req.body;
    if (!menuItemId || !qty) return res.status(400).json({ error: 'menuItemId and qty are required' });

    const order = await prisma.posOrder.findUnique({ where: { id: Number(req.params.id) } });
    if (!assertOrder(order, res)) return;
    if (['paid', 'voided'].includes(order.status)) return res.status(400).json({ error: `Cannot add items to a ${order.status} order` });

    const menuItem = await prisma.posMenuItem.findUnique({
      where: { id: Number(menuItemId) },
      include: { taxClass: { include: { taxes: { include: { tax: true } } } } },
    });
    if (!menuItem) return res.status(404).json({ error: 'Menu item not found' });

    const { basePrice, finalPrice, taxes: taxLines } = calculateItemPriceBreakdown(menuItem.defaultRate, menuItem.taxClass, menuItem.priceType);
    const unitPrice = Number(basePrice.toFixed(2));
    const unitPriceWithTax = Number(finalPrice.toFixed(2));
    const taxBreakdown = calculateItemTaxes(menuItem.defaultRate, Number(qty), menuItem.taxClass, menuItem.priceType);

    const orderItem = await prisma.$transaction(async (tx) => {
      const item = await tx.posOrderItem.create({
        data: {
          orderId: Number(req.params.id),
          menuItemId: Number(menuItemId),
          qty,
          unitPrice,
          unitPriceWithTax,
          comment,
          taxClassId: menuItem.taxClassId,
          sentAt: new Date(),
          taxes: {
            create: taxBreakdown.map(t => ({
              taxId: t.taxId,
              taxAmount: Number(t.totalAmount.toFixed(2)),
            })),
          },
        },
        include: { menuItem: true, taxes: { include: { tax: true } } },
      });

      // Update order status to 'sent' if it was 'open'
      if (order.status === 'open') {
        await tx.posOrder.update({ where: { id: Number(req.params.id) }, data: { status: 'sent' } });
      }

      return item;
    });

    // Trigger KOT/BOT print (non-blocking)
    triggerKotPrint(order.id, orderItem.id, menuItem.printerStationId, req.user.id).catch(console.error);

    res.status(201).json(orderItem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MODIFY ITEM (qty / comment) ───────────────────────────────────────────────

// PATCH /api/pos/orders/:id/items/:itemId
router.patch('/:id/items/:itemId', authenticate, async (req, res) => {
  try {
    const { qty, comment } = req.body;
    const updated = await prisma.posOrderItem.update({
      where: { id: Number(req.params.itemId) },
      data: { qty, comment },
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── VOID ITEM ─────────────────────────────────────────────────────────────────

// POST /api/pos/orders/:id/items/:itemId/void
// body: { qty, voidReasonId? }
router.post('/:id/items/:itemId/void', authenticate, async (req, res) => {
  try {
    const { qty, voidReasonId } = req.body;
    const orderItem = await prisma.posOrderItem.findUnique({ where: { id: Number(req.params.itemId) } });
    if (!orderItem) return res.status(404).json({ error: 'Order item not found' });

    const voidLog = await prisma.posItemVoid.create({
      data: {
        orderItemId: Number(req.params.itemId),
        orderId: Number(req.params.id),
        voidReasonId: voidReasonId ? Number(voidReasonId) : null,
        qty: qty || orderItem.qty,
        voidedBy: req.user.id,
      },
    });
    res.status(201).json(voidLog);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TRANSFER TABLE ────────────────────────────────────────────────────────────

// POST /api/pos/orders/:id/transfer
// body: { toTableId }
router.post('/:id/transfer', authenticate, async (req, res) => {
  try {
    const { toTableId } = req.body;
    if (!toTableId) return res.status(400).json({ error: 'toTableId is required' });

    const order = await prisma.posOrder.findUnique({ where: { id: Number(req.params.id) } });
    if (!assertOrder(order, res)) return;

    // Check target table is free
    const targetTable = await prisma.posTable.findUnique({ where: { id: Number(toTableId) } });
    if (!targetTable) return res.status(404).json({ error: 'Target table not found' });
    if (targetTable.status !== 'free') return res.status(409).json({ error: 'Target table is not free' });

    await prisma.$transaction([
      prisma.posOrder.update({ where: { id: Number(req.params.id) }, data: { tableId: Number(toTableId) } }),
      prisma.posTable.update({ where: { id: order.tableId }, data: { status: 'free' } }),
      prisma.posTable.update({ where: { id: Number(toTableId) }, data: { status: 'occupied' } }),
      prisma.posTableTransfer.create({
        data: {
          orderId: Number(req.params.id),
          fromTableId: order.tableId,
          toTableId: Number(toTableId),
          transferredBy: req.user.id,
        },
      }),
    ]);

    res.json({ success: true, message: `Order moved to table ${targetTable.name}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SPLIT ORDER ───────────────────────────────────────────────────────────────

// POST /api/pos/orders/:id/split
// body: { itemIds: [{ orderItemId, qty }] }  — items to move to a new order
router.post('/:id/split', authenticate, async (req, res) => {
  try {
    const { itemIds } = req.body;
    if (!itemIds || !itemIds.length) return res.status(400).json({ error: 'itemIds is required' });

    const parentOrder = await prisma.posOrder.findUnique({
      where: { id: Number(req.params.id) },
      include: { table: true },
    });
    if (!assertOrder(parentOrder, res)) return;

    const newOrder = await prisma.$transaction(async (tx) => {
      // Create child order
      const child = await tx.posOrder.create({
        data: {
          outletId: parentOrder.outletId,
          tableId: parentOrder.tableId,
          waiterId: parentOrder.waiterId,
          mealPeriodId: parentOrder.mealPeriodId,
          parentOrderId: parentOrder.id,
          hasSplit: false,
          status: 'sent',
          nightDate: parentOrder.nightDate,
          createdBy: req.user.id,
          remark: `Split from order #${parentOrder.id}`,
        },
      });

      // Move specified items to child order
      for (const { orderItemId, qty } of itemIds) {
        await tx.posOrderItem.update({
          where: { id: Number(orderItemId) },
          data: { orderId: child.id, qty },
        });
      }

      // Mark parent as split
      await tx.posOrder.update({ where: { id: parentOrder.id }, data: { hasSplit: true } });

      return child;
    });

    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH ORDER STATUS ────────────────────────────────────────────────────────

// PATCH /api/pos/orders/:id/status
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['open', 'sent', 'billed', 'paid', 'voided'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });

    const order = await prisma.posOrder.update({
      where: { id: Number(req.params.id) },
      data: {
        status,
        closedAt: ['paid', 'voided'].includes(status) ? new Date() : undefined,
      },
    });

    // Free table when order closes
    if (['paid', 'voided'].includes(status)) {
      await prisma.posTable.update({ where: { id: order.tableId }, data: { status: 'free' } });
    }

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
