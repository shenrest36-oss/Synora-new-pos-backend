const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');

// GET /api/pos/tables?outlet_id=
router.get('/', authenticate, async (req, res) => {
  try {
    const { outlet_id } = req.query;
    const tables = await prisma.posTable.findMany({
      where: outlet_id ? { outletId: Number(outlet_id) } : undefined,
      include: {
        section: true,
        orders: {
          where: { status: { in: ['open', 'sent', 'billed'] } },
          select: { id: true, status: true, openedAt: true },
        },
      },
      orderBy: [{ outletId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/tables
router.post('/', authenticate, async (req, res) => {
  try {
    const { outletId, sectionId, name, seats, sortOrder } = req.body;
    if (!outletId || !name) return res.status(400).json({ error: 'outletId and name are required' });
    const table = await prisma.posTable.create({
      data: { outletId: Number(outletId), sectionId: sectionId ? Number(sectionId) : null, name, seats: seats || 4, sortOrder: sortOrder || 0 },
    });
    res.status(201).json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pos/tables/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, seats, sortOrder, sectionId } = req.body;
    const table = await prisma.posTable.update({
      where: { id: Number(req.params.id) },
      data: { name, seats, sortOrder, sectionId: sectionId ? Number(sectionId) : null },
    });
    res.json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/pos/tables/:id/status
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['free', 'occupied', 'reserved', 'cleaning'];
    if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    const table = await prisma.posTable.update({
      where: { id: Number(req.params.id) },
      data: { status },
    });
    res.json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
