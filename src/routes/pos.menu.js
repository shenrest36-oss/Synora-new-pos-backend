const express = require('express');
const router = express.Router();
const prisma = require('../prismaClient');
const { authenticate } = require('../middlewares/auth');

function resolveCategoryLevel(level) {
  const next = Number(level);
  if (!Number.isInteger(next) || next < 1 || next > 3) {
    throw new Error('Category level must be between 1 and 3');
  }
  return next;
}

async function validateCategoryParent(parentId, level) {
  if (parentId === undefined || parentId === null || parentId === '') {
    if (level === 1) return null;
    throw new Error('Parent group is required for level 2 and 3 categories');
  }

  const parent = await prisma.posMenuCategory.findUnique({ where: { id: Number(parentId) } });
  if (!parent) {
    throw new Error('Parent group not found');
  }
  if (parent.level !== level - 1) {
    throw new Error(`Level ${level} categories must belong to a level ${level - 1} parent group`);
  }
  return parent;
}

// ── MENU CATEGORIES ──────────────────────────────────────────────────────────

// GET /api/pos/menu/categories  — returns full tree
router.get('/categories', authenticate, async (req, res) => {
  try {
    // Fetch all categories and build tree client-side
    const categories = await prisma.posMenuCategory.findMany({
      where: { isActive: true },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/menu/categories/:id/children
router.get('/categories/:id/children', authenticate, async (req, res) => {
  try {
    const children = await prisma.posMenuCategory.findMany({
      where: { parentId: Number(req.params.id), isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(children);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/menu/categories
router.post('/categories', authenticate, async (req, res) => {
  try {
    const { parentId, name, level, sortOrder, imageUrl } = req.body;
    const cleanedName = typeof name === 'string' ? name.trim() : '';
    const cleanedLevel = resolveCategoryLevel(level);

    if (!cleanedName) return res.status(400).json({ error: 'Category name is required' });

    const resolvedParent = await validateCategoryParent(parentId, cleanedLevel);
    const cat = await prisma.posMenuCategory.create({
      data: {
        parentId: resolvedParent ? resolvedParent.id : null,
        name: cleanedName,
        level: cleanedLevel,
        sortOrder: sortOrder || 0,
        imageUrl,
      },
    });
    res.status(201).json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pos/menu/categories/:id
router.put('/categories/:id', authenticate, async (req, res) => {
  try {
    const { name, sortOrder, imageUrl, isActive } = req.body;
    const cat = await prisma.posMenuCategory.update({
      where: { id: Number(req.params.id) },
      data: { name, sortOrder, imageUrl, isActive },
    });
    res.json(cat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MENU ITEMS ────────────────────────────────────────────────────────────────

// GET /api/pos/menu/items?category_id=&outlet_id=&search=
router.get('/items', authenticate, async (req, res) => {
  try {
    const { category_id, search } = req.query;
    const where = { isActive: true };
    if (category_id) where.categoryId = Number(category_id);
    if (search) where.name = { contains: search };

    const items = await prisma.posMenuItem.findMany({
      where,
      include: { category: true, taxClass: { include: { taxes: { include: { tax: true } } } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/pos/menu/items/:id
router.get('/items/:id', authenticate, async (req, res) => {
  try {
    const item = await prisma.posMenuItem.findUnique({
      where: { id: Number(req.params.id) },
      include: { category: true, taxClass: { include: { taxes: { include: { tax: true } } } } },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/menu/items
router.post('/items', authenticate, async (req, res) => {
  try {
    const { categoryId, name, defaultRate, taxClassId, printerStationId, isSetMenu, imageUrl, sortOrder, barCode, priceType, price_type } = req.body;
    if (!categoryId || !name || defaultRate == null) return res.status(400).json({ error: 'categoryId, name, defaultRate are required' });

    const cleanedPriceType = String(priceType ?? price_type ?? 'exclusive').toLowerCase();
    if (!['exclusive', 'inclusive'].includes(cleanedPriceType)) {
      return res.status(400).json({ error: 'Price type must be either exclusive or inclusive' });
    }

    const category = await prisma.posMenuCategory.findUnique({ where: { id: Number(categoryId) } });
    if (!category) {
      return res.status(400).json({ error: 'Selected category not found' });
    }
    if (category.level !== 3) {
      return res.status(400).json({ error: 'Menu items can only be assigned to a family group (Level 3)'});
    }

    const item = await prisma.posMenuItem.create({
      data: {
        categoryId: Number(categoryId),
        name,
        defaultRate,
        priceType: cleanedPriceType,
        taxClassId: taxClassId ? Number(taxClassId) : null,
        printerStationId: printerStationId ? Number(printerStationId) : null,
        isSetMenu: isSetMenu || false,
        imageUrl,
        sortOrder: sortOrder || 0,
        barCode,
      },
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/pos/menu/items/:id
router.put('/items/:id', authenticate, async (req, res) => {
  try {
    const { name, defaultRate, taxClassId, printerStationId, categoryId, isSetMenu, isActive, imageUrl, sortOrder, priceType, price_type } = req.body;
    const cleanedPriceType = priceType === undefined && price_type === undefined ? undefined : String(priceType ?? price_type ?? 'exclusive').toLowerCase();
    if (cleanedPriceType && !['exclusive', 'inclusive'].includes(cleanedPriceType)) {
      return res.status(400).json({ error: 'Price type must be either exclusive or inclusive' });
    }

    const item = await prisma.posMenuItem.update({
      where: { id: Number(req.params.id) },
      data: { name, defaultRate, priceType: cleanedPriceType, taxClassId: taxClassId ? Number(taxClassId) : undefined, printerStationId: printerStationId ? Number(printerStationId) : undefined, categoryId: categoryId ? Number(categoryId) : undefined, isSetMenu, isActive, imageUrl, sortOrder },
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TAX CLASSES ───────────────────────────────────────────────────────────────

// GET /api/pos/menu/tax-classes
router.get('/tax-classes', authenticate, async (req, res) => {
  try {
    const classes = await prisma.posTaxClass.findMany({
      include: { taxes: { include: { tax: true } } },
    });
    res.json(classes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/menu/tax-classes
router.post('/tax-classes', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const tc = await prisma.posTaxClass.create({ data: { name } });
    res.status(201).json(tc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── MEAL PERIODS ──────────────────────────────────────────────────────────────

// GET /api/pos/menu/meal-periods
router.get('/meal-periods', authenticate, async (req, res) => {
  try {
    const periods = await prisma.posMealPeriod.findMany({
      where: { isActive: true },
      orderBy: { fromTime: 'asc' },
    });
    res.json(periods);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/menu/meal-periods
router.post('/meal-periods', authenticate, async (req, res) => {
  try {
    const { name, fromTime, toTime } = req.body;
    if (!name || !fromTime || !toTime) return res.status(400).json({ error: 'name, fromTime, toTime are required' });
    const mp = await prisma.posMealPeriod.create({ data: { name, fromTime, toTime } });
    res.status(201).json(mp);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── VOID REASONS ─────────────────────────────────────────────────────────────

// GET /api/pos/menu/void-reasons
router.get('/void-reasons', authenticate, async (req, res) => {
  try {
    const reasons = await prisma.posVoidReason.findMany({ orderBy: { reason: 'asc' } });
    res.json(reasons);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/pos/menu/void-reasons
router.post('/void-reasons', authenticate, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const vr = await prisma.posVoidReason.create({ data: { reason } });
    res.status(201).json(vr);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
