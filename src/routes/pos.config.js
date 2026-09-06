const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');

// GET  /api/pos/config/waiters
router.get('/waiters', authenticate, async (req, res) => {
  try {
    res.json(await prisma.posWaiter.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pos/config/waiters
router.post('/waiters', authenticate, async (req, res) => {
  try {
    const { code, name } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
    res.status(201).json(await prisma.posWaiter.create({ data: { code, name } }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/pos/config/waiters/:id
router.put('/waiters/:id', authenticate, async (req, res) => {
  try {
    const { code, name, isActive } = req.body;
    res.json(await prisma.posWaiter.update({ where: { id: Number(req.params.id) }, data: { code, name, isActive } }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET  /api/pos/config/printer-stations
router.get('/printer-stations', authenticate, async (req, res) => {
  try {
    res.json(await prisma.posPrinterStation.findMany({ where: { isActive: true }, include: { outlet: true } }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pos/config/printer-stations
router.post('/printer-stations', authenticate, async (req, res) => {
  try {
    const { outletId, name, printerType } = req.body;
    if (!outletId || !name) return res.status(400).json({ error: 'outletId and name are required' });
    res.status(201).json(await prisma.posPrinterStation.create({ data: { outletId: Number(outletId), name, printerType: printerType || 0 } }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET  /api/pos/config/taxes
router.get('/taxes', authenticate, async (req, res) => {
  try {
    res.json(await prisma.posTax.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pos/config/taxes
router.post('/taxes', authenticate, async (req, res) => {
  try {
    const { name, rate, description } = req.body;
    if (!name || rate == null) return res.status(400).json({ error: 'name and rate are required' });
    res.status(201).json(await prisma.posTax.create({ data: { name, rate: Number(rate), description } }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/pos/config/tax-classes/:id/taxes  — link a tax to a tax class
router.post('/tax-classes/:id/taxes', authenticate, async (req, res) => {
  try {
    const { taxId } = req.body;
    if (!taxId) return res.status(400).json({ error: 'taxId is required' });
    res.status(201).json(await prisma.posTaxClassTax.create({
      data: { taxClassId: Number(req.params.id), taxId: Number(taxId) },
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
