const express = require('express');
const router = express.Router();
const prisma = require('../ellaPrismaClient');
const { authenticate } = require('../middlewares/auth');

/**
 * GET /api/pos/guests/room-lookup?room=101
 * Looks up in-house guest in ella_pms reservations by room number.
 * Returns guest info + reservationId needed for room posting.
 */
router.get('/room-lookup', authenticate, async (req, res) => {
  try {
    const { room } = req.query;
    if (!room) return res.status(400).json({ error: 'room query param is required' });

    // Normalize room input to avoid formatting mismatches (trim and lowercase)
    const normalizedRoom = String(room).trim().toLowerCase();

    // Accept several common reservation status variants to be tolerant of PMS differences
    const allowedStatuses = ['in_house', 'inhouse', 'due_checkout', 'duecheckout', 'checked_in', 'checkedin'];

    // Raw query into ella_pms — same database, no Prisma model needed
    const statusList = allowedStatuses.map(s => `'${s}'`).join(',');

    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        r.id           AS reservationId,
        r.confo_no     AS confoNo,
        r.status       AS reservationStatus,
        rm.room_number AS roomNumber,
        g.id           AS guestId,
        g.full_name    AS guestName,
        g.phone        AS guestPhone,
        r.check_in     AS checkIn,
        r.check_out    AS checkOut
      FROM reservations r
      JOIN rooms rm  ON rm.id = r.room_id
      JOIN guests g  ON g.id  = r.guest_id
      WHERE TRIM(LOWER(rm.room_number)) = ?
        AND r.status IN (${statusList})
      LIMIT 1
      `,
      normalizedRoom
    );

    if (!rows.length) {
      // Helpful fallback for debugging: check if any reservation exists for the room at all
      const fallback = await prisma.$queryRawUnsafe(
        `
        SELECT r.id AS reservationId, r.status AS reservationStatus, rm.room_number AS roomNumber
        FROM reservations r
        JOIN rooms rm ON rm.id = r.room_id
        WHERE TRIM(LOWER(rm.room_number)) = ?
        LIMIT 1
        `,
        normalizedRoom
      );

      if (fallback.length) {
        const info = JSON.parse(JSON.stringify(fallback[0], (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
        // Log for server-side debugging so operators can inspect quickly
        console.warn(`room-lookup: room ${room} has reservation ${info.reservationId} with status ${info.reservationStatus}`);
        return res.status(404).json({ error: `No in-house guest found for room ${room}`, reservation: info });
      }

      return res.status(404).json({ error: `No in-house guest found for room ${room}` });
    }

    // Convert BigInt fields (MySQL returns BigInt for some raw cols)
    const guest = JSON.parse(JSON.stringify(rows[0], (_k, v) => (typeof v === 'bigint' ? Number(v) : v)));
    res.json(guest);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
