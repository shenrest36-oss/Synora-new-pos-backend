const prisma = require('../prismaClient');

const clients = new Set();

function getKitchenStatus(order) {
  if (!order) return 'new';
  return order.kitchenStatus || order.kitchen_status || 'new';
}

function normalizeKitchenOrder(order) {
  if (!order) return null;

  const stage = getKitchenStatus(order);
  const openedAt = order.opened_at || order.openedAt || new Date().toISOString();
  const startedAt = order.started_at || order.startedAt;
  const readyAt = order.ready_at || order.readyAt;
  const cancelledAt = order.cancelled_at || order.cancelledAt;
  const itemSummary = order.item_summary || order.itemSummary || 'No items';
  const tableName = order.table_name || order.tableName || 'Table';

  const startedValue = startedAt ? new Date(startedAt) : new Date(openedAt);
  const elapsedMinutes = Number.isFinite(Number(order.elapsedMinutes))
    ? Number(order.elapsedMinutes)
    : Math.max(0, Math.round((Date.now() - startedValue.getTime()) / 60000));

  let aging = 'neutral';
  if (elapsedMinutes >= 15) aging = 'danger';
  else if (elapsedMinutes >= 8) aging = 'warning';

  return {
    id: Number(order.id),
    outletId: Number(order.outlet_id ?? order.outletId ?? 0),
    tableId: Number(order.table_id ?? order.tableId ?? 0),
    tableName,
    kitchenStatus: stage,
    kitchen_status: stage,
    itemSummary,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    started_at: startedAt ? new Date(startedAt).toISOString() : null,
    readyAt: readyAt ? new Date(readyAt).toISOString() : null,
    ready_at: readyAt ? new Date(readyAt).toISOString() : null,
    cancelledAt: cancelledAt ? new Date(cancelledAt).toISOString() : null,
    cancelled_at: cancelledAt ? new Date(cancelledAt).toISOString() : null,
    cancelledReason: order.cancelled_reason || order.cancelledReason || null,
    cancelled_reason: order.cancelled_reason || order.cancelledReason || null,
    openedAt: new Date(openedAt).toISOString(),
    opened_at: new Date(openedAt).toISOString(),
    elapsedMinutes,
    aging,
  };
}

async function fetchKitchenOrderSnapshot(orderId) {
  const rows = await prisma.$queryRawUnsafe(`
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
    WHERE o.id = ${Number(orderId)}
    GROUP BY o.id, o.outlet_id, o.table_id, t.name, o.kitchen_status, o.started_at, o.ready_at, o.cancelled_at, o.cancelled_reason, o.opened_at
    LIMIT 1;
  `);

  const record = rows && rows[0] ? rows[0] : null;
  if (!record) return null;

  return normalizeKitchenOrder(record);
}

function addKitchenStreamClient(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write('retry: 1000\n\n');
  clients.add(response);

  response.on('close', () => {
    clients.delete(response);
  });
}

function broadcastKitchenOrder(order) {
  if (!order) return;

  const payload = {
    type: 'kitchen-order-update',
    order,
  };

  const message = `event: kitchen-update\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of [...clients]) {
    try {
      client.write(message);
    } catch (error) {
      clients.delete(client);
    }
  }
}

module.exports = {
  addKitchenStreamClient,
  broadcastKitchenOrder,
  fetchKitchenOrderSnapshot,
  normalizeKitchenOrder,
};
