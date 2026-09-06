const prisma = require('../ellaPrismaClient');

/**
 * roomPostingService.js
 *
 * Posts a restaurant bill charge to the Ella PMS guest folio.
 * Inserts into ella_pms.guest_charges (same database, same Prisma client).
 * The charge appears immediately on the Ella PMS folio / checkout-balance screen.
 */

// Ella PMS charge_type id for "Restaurant" — cached after first lookup
let restaurantChargeTypeId = null;

async function getRestaurantChargeTypeId() {
  if (restaurantChargeTypeId) return restaurantChargeTypeId;

  // Look up via raw query since charge_types model lives in Ella PMS Prisma schema,
  // but we share the same database so $queryRaw works fine.
  const rows = await prisma.$queryRaw`
    SELECT id FROM charge_types WHERE name = 'Restaurant' LIMIT 1
  `;

  if (rows.length > 0) {
    restaurantChargeTypeId = Number(rows[0].id);
    return restaurantChargeTypeId;
  }

  // Create it if it doesn't exist
  const result = await prisma.$executeRaw`
    INSERT INTO charge_types (name) VALUES ('Restaurant')
  `;
  // Fetch the new id
  const newRows = await prisma.$queryRaw`
    SELECT id FROM charge_types WHERE name = 'Restaurant' LIMIT 1
  `;
  restaurantChargeTypeId = Number(newRows[0].id);
  return restaurantChargeTypeId;
}

/**
 * @param {object} params
 * @param {number} params.reservationId  — ella_pms reservations.id
 * @param {number} params.amount         — charge amount
 * @param {string} params.billNo         — POS bill number for reference
 * @param {string} params.description    — e.g. "Restaurant — Bill #POS-20260902-0001"
 * @param {number} params.postedBy       — ella_pms users.id (from JWT)
 * @returns {number} guestChargeId — the new guest_charges.id
 */
async function postToRoomFolio({ reservationId, amount, billNo, description, postedBy }) {
  const chargeTypeId = await getRestaurantChargeTypeId();

  // Verify reservation is in-house
  const reservations = await prisma.$queryRaw`
    SELECT id, status FROM reservations WHERE id = ${reservationId} LIMIT 1
  `;
  if (!reservations.length) throw new Error(`Reservation ${reservationId} not found`);
  const reservation = reservations[0];
  const allowedStatuses = ['in_house', 'due_checkout', 'checked_in'];
  if (!allowedStatuses.includes(reservation.status)) {
    throw new Error(`Reservation ${reservationId} is not in-house (status: ${reservation.status})`);
  }

  // Insert guest_charge into ella_pms
  await prisma.$executeRaw`
    INSERT INTO guest_charges
      (reservation_id, charge_type_id, description, amount, posted_by, posted_at, is_void)
    VALUES
      (${reservationId}, ${chargeTypeId}, ${description}, ${amount}, ${postedBy}, NOW(), 0)
  `;

  // Retrieve the new charge id
  const rows = await prisma.$queryRaw`
    SELECT id FROM guest_charges
    WHERE reservation_id = ${reservationId}
      AND description = ${description}
    ORDER BY posted_at DESC
    LIMIT 1
  `;

  return Number(rows[0].id);
}

module.exports = { postToRoomFolio };
