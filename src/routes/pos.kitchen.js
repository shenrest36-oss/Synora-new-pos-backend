const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');
const { broadcastKitchenOrder, fetchKitchenOrderSnapshot } = require('../services/kitchenStream');

const KITCHEN_STAGE_ORDER = ['new', 'preparing', 'ready', 'cancelled'];
const STAGE_TRANSITIONS = {
  new: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: [],
  cancelled: [],
};

function sqlString(value) {
  return `'${String(value).replace(/'/g, "\\'")}'`;
}

function normalizeStages(rawStages) {
  if (!rawStages) return KITCHEN_STAGE_ORDER;
  const values = String(rawStages)
    .split(',')
    .map((stage) => stage.trim().toLowerCase())
    .filter(Boolean);
  if (!values.length) return KITCHEN_STAGE_ORDER;
  const unique = [...new Set(values)];
  return unique.filter((stage) => KITCHEN_STAGE_ORDER.includes(stage));
}

function normalizeLegacyKitchenStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return 'new';
  if (normalized === 'served') return 'ready';
  return normalized;
}

async function ensureKitchenSchemaCompatibility() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT COLUMN_NAME AS column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'pos_orders';
    `;
    const columns = new Set((rows || []).map((row) => String(row.column_name || row.COLUMN_NAME || '').toLowerCase()));

    if (columns.has('served_at')) {
      await prisma.$executeRaw`ALTER TABLE pos_orders DROP COLUMN served_at;`;
    }

    if (columns.has('kitchen_status')) {
      await prisma.$executeRaw`UPDATE pos_orders SET kitchen_status = 'ready' WHERE kitchen_status = 'served';`;
    }
  } catch (error) {
    console.warn('Kitchen schema compatibility check failed:', error.message);
  }
}

function currentStageFromOrder(order) {
  if (!order) return 'new';
  return normalizeLegacyKitchenStatus(order.kitchen_status || order.kitchenStatus || order.kitchen_status || 'new');
}

function buildKitchenOrderResponse(order) {
  const stage = currentStageFromOrder(order);
  const ageStart = order.started_at || order.opened_at;
  const now = new Date();
  const startedAt = ageStart ? new Date(ageStart) : new Date(order.opened_at || now);
  const elapsedMinutes = Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60000));

  let aging = 'neutral';
  if (elapsedMinutes >= 15) aging = 'danger';
  else if (elapsedMinutes >= 8) aging = 'warning';

  return {
    id: Number(order.id),
    outletId: Number(order.outlet_id),
    tableId: Number(order.table_id),
    tableName: order.table_name || 'Table',
    kitchenStatus: stage,
    kitchen_status: stage,
    itemSummary: order.item_summary || 'No items',
    startedAt: order.started_at ? new Date(order.started_at).toISOString() : null,
    started_at: order.started_at ? new Date(order.started_at).toISOString() : null,
    readyAt: order.ready_at ? new Date(order.ready_at).toISOString() : null,
    ready_at: order.ready_at ? new Date(order.ready_at).toISOString() : null,
    cancelledAt: order.cancelled_at ? new Date(order.cancelled_at).toISOString() : null,
    cancelled_at: order.cancelled_at ? new Date(order.cancelled_at).toISOString() : null,
    cancelledReason: order.cancelled_reason || null,
    cancelled_reason: order.cancelled_reason || null,
    openedAt: order.opened_at ? new Date(order.opened_at).toISOString() : null,
    opened_at: order.opened_at ? new Date(order.opened_at).toISOString() : null,
    elapsedMinutes,
    aging,
  };
}

router.get('/orders', authenticate, async (req, res) => {
  try {
    await ensureKitchenSchemaCompatibility();
    const { outlet_id, stage } = req.query;
    const stages = normalizeStages(stage);
    const outletId = outlet_id ? Number(outlet_id) : null;

    if (!stages.length) {
      return res.json([]);
    }

    const stageClause = stages.map((s) => `'${s}'`).join(', ');
    const orderByStage = `CASE o.kitchen_status WHEN 'new' THEN 1 WHEN 'preparing' THEN 2 WHEN 'ready' THEN 3 WHEN 'cancelled' THEN 4 ELSE 5 END`;

    const baseWhere = ['o.kitchen_status IN (' + stageClause + ')'];
    if (outletId) baseWhere.push(`o.outlet_id = ${outletId}`);

    const orders = await prisma.$queryRawUnsafe(`
      SELECT
        o.id,
        o.outlet_id,
        o.table_id,
        t.name AS table_name,
        o.kitchen_status,
        o.started_at,
        o.ready_at,
        o.cancelled_at,
        o.cancelled_reason,
        o.opened_at,
        COALESCE(
          GROUP_CONCAT(DISTINCT CONCAT(CAST(oi.qty AS CHAR), 'x ', mi.name) ORDER BY mi.name SEPARATOR ', '),
          'No items'
        ) AS item_summary
      FROM pos_orders o
      LEFT JOIN pos_tables t ON t.id = o.table_id
      LEFT JOIN pos_order_items oi ON oi.order_id = o.id
      LEFT JOIN pos_menu_items mi ON mi.id = oi.menu_item_id
      WHERE ${baseWhere.join(' AND ')}
      GROUP BY o.id, o.outlet_id, o.table_id, t.name, o.kitchen_status, o.started_at, o.ready_at, o.cancelled_at, o.cancelled_reason, o.opened_at
      ORDER BY ${orderByStage}, o.opened_at DESC
    `);

    const normalized = (orders || []).map((order) => buildKitchenOrderResponse(order));
    res.json(normalized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/orders/:id/status', authenticate, async (req, res) => {
  try {
    await ensureKitchenSchemaCompatibility();
    const { status, reason } = req.body;
    const nextStatus = String(status || '').trim().toLowerCase();
    const allowedStatusValues = ['preparing', 'ready', 'cancelled'];

    if (!allowedStatusValues.includes(nextStatus)) {
      return res.status(400).json({ error: `status must be one of: ${allowedStatusValues.join(', ')}` });
    }

    const existingRows = await prisma.$queryRawUnsafe(`
      SELECT id, kitchen_status, opened_at, started_at, ready_at, cancelled_at, cancelled_reason
      FROM pos_orders
      WHERE id = ${Number(req.params.id)}
      LIMIT 1;
    `);

    if (!existingRows.length) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const currentStatus = currentStageFromOrder(existingRows[0]);
    const validTransitions = STAGE_TRANSITIONS[currentStatus] || [];

    if (!validTransitions.includes(nextStatus)) {
      return res.status(400).json({
        error: `Illegal kitchen transition: ${currentStatus} -> ${nextStatus}`,
        from: currentStatus,
        to: nextStatus,
      });
    }

    if (nextStatus === 'cancelled') {
      const trimmedReason = String(reason || '').trim();
      if (!trimmedReason) {
        return res.status(400).json({ error: 'cancelled_reason is required when cancelling an order' });
      }
    }

    const updateParts = [`kitchen_status = ${sqlString(nextStatus)}`];
    switch (nextStatus) {
      case 'preparing':
        updateParts.push('started_at = COALESCE(started_at, NOW())');
        break;
      case 'ready':
        updateParts.push('ready_at = NOW()');
        break;
      case 'cancelled':
        updateParts.push('cancelled_at = NOW()');
        updateParts.push(`cancelled_reason = ${sqlString(String(reason || '').trim())}`);
        break;
      default:
        break;
    }

    await prisma.$executeRawUnsafe(`
      UPDATE pos_orders
      SET ${updateParts.join(', ')}
      WHERE id = ${Number(req.params.id)};
    `);

    const updatedRows = await prisma.$queryRawUnsafe(`
      SELECT
        o.id,
        o.outlet_id,
        o.table_id,
        t.name AS table_name,
        o.kitchen_status,
        o.started_at,
        o.ready_at,
        o.cancelled_at,
        o.cancelled_reason,
        o.opened_at,
        COALESCE(
          GROUP_CONCAT(DISTINCT CONCAT(CAST(oi.qty AS CHAR), 'x ', mi.name) ORDER BY mi.name SEPARATOR ', '),
          'No items'
        ) AS item_summary
      FROM pos_orders o
      LEFT JOIN pos_tables t ON t.id = o.table_id
      LEFT JOIN pos_order_items oi ON oi.order_id = o.id
      LEFT JOIN pos_menu_items mi ON mi.id = oi.menu_item_id
      WHERE o.id = ${Number(req.params.id)}
      GROUP BY o.id, o.outlet_id, o.table_id, t.name, o.kitchen_status, o.started_at, o.ready_at, o.cancelled_at, o.cancelled_reason, o.opened_at
      LIMIT 1;
    `);

    const row = updatedRows[0] || {};
    const payload = buildKitchenOrderResponse(row);
    broadcastKitchenOrder(payload);
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
