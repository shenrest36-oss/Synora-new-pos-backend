const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');

// GET /api/pos/outlets
router.get('/', authenticate, async (req, res) => {
  try {
    const outlets = await prisma.posOutlet.findMany({
      where: { isActive: true },
      include: { sections: true, _count: { select: { tables: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(outlets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/outlets/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const outlet = await prisma.posOutlet.findUnique({
      where: { id: Number(req.params.id) },
      include: { sections: true, tables: true, printerStations: true },
    });
    if (!outlet) return res.status(404).json({ error: 'Outlet not found' });
    res.json(outlet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/outlets
router.post('/', authenticate, async (req, res) => {
  try {
    const { name, location, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const outlet = await prisma.posOutlet.create({
      data: { name, location, description },
    });
    res.status(201).json(outlet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pos/outlets/:id
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, location, description, isActive } = req.body;
    const outlet = await prisma.posOutlet.update({
      where: { id: Number(req.params.id) },
      data: { name, location, description, isActive },
    });
    res.json(outlet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
