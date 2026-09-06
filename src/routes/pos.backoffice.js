const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const prisma = require('../prismaClient');
const ellaPrisma = require('../ellaPrismaClient');
const { authenticate, requireAdmin } = require('../middlewares/auth');

router.use(authenticate);
router.use(requireAdmin);

function parseId(value, label) {
  const id = Number(value);
  if (!Number.isFinite(id)) {
    throw new Error(`${label} must be a valid number`);
  }
  return id;
}

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

// Menu categories
router.get('/categories', async (_req, res) => {
  try {
    const categories = await prisma.posMenuCategory.findMany({
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', async (req, res) => {
  try {
    const { parentId, name, level, sortOrder, imageUrl, isActive } = req.body;
    const cleanedName = typeof name === 'string' ? name.trim() : '';
    const cleanedLevel = resolveCategoryLevel(level);

    if (!cleanedName) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const resolvedParentId = await validateCategoryParent(parentId, cleanedLevel);

    const category = await prisma.posMenuCategory.create({
      data: {
        parentId: resolvedParentId ? resolvedParentId.id : null,
        name: cleanedName,
        level: cleanedLevel,
        sortOrder: sortOrder ?? 0,
        imageUrl: imageUrl || null,
        isActive: isActive ?? true,
      },
    });
    res.status(201).json(category);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'category id');
    const { name, parentId, level, sortOrder, imageUrl, isActive } = req.body;
    const cleanedName = typeof name === 'string' ? name.trim() : undefined;
    const cleanedLevel = level === undefined ? undefined : resolveCategoryLevel(level);
    const cleanedParentId = parentId === undefined || parentId === null || parentId === '' ? null : Number(parentId);

    if (cleanedName !== undefined && !cleanedName) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const nextLevel = cleanedLevel ?? (await prisma.posMenuCategory.findUnique({ where: { id }, select: { level: true } }))?.level;
    if (nextLevel === undefined) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (cleanedParentId !== null || nextLevel > 1 || cleanedLevel !== undefined) {
      const parent = await validateCategoryParent(cleanedParentId !== null ? cleanedParentId : (nextLevel === 1 ? null : undefined), nextLevel);
      if (parent === null && nextLevel > 1) {
        return res.status(400).json({ error: 'Parent group is required for level 2 and 3 categories' });
      }
    }

    const category = await prisma.posMenuCategory.update({
      where: { id },
      data: {
        name: cleanedName,
        parentId: parentId === undefined ? undefined : cleanedParentId,
        level: cleanedLevel,
        sortOrder: sortOrder === undefined ? undefined : Number(sortOrder),
        imageUrl: imageUrl === undefined ? undefined : imageUrl || null,
        isActive,
      },
    });
    res.json(category);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'category id');
    await prisma.posMenuCategory.update({
      where: { id },
      data: { isActive: false },
    });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Menu items
router.get('/menu-categories', async (_req, res) => {
  try {
    const categories = await prisma.posMenuCategory.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/menu-items', async (_req, res) => {
  try {
    const items = await prisma.posMenuItem.findMany({
      include: { category: true, taxClass: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/menu-items', async (req, res) => {
  try {
    const { name, category_id, categoryId, price, defaultRate, tax_class_id, taxClassId, printer_station_id, printerStationId, is_active, isActive, price_type, priceType } = req.body;

    const cleanedName = typeof name === 'string' ? name.trim() : '';
    const cleanedCategoryId = category_id ?? categoryId;
    const cleanedPrice = price ?? defaultRate;
    const cleanedTaxClassId = tax_class_id ?? taxClassId;
    const cleanedPrinterStationId = printer_station_id ?? printerStationId;
    const cleanedPriceType = String(price_type ?? priceType ?? 'exclusive').toLowerCase();
    const cleanedIsActive = is_active !== undefined ? Boolean(is_active) : Boolean(isActive ?? true);

    if (!cleanedName) {
      return res.status(400).json({ error: 'Item name is required' });
    }
    if (!cleanedCategoryId) {
      return res.status(400).json({ error: 'Category is required' });
    }
    if (cleanedPrice === undefined || cleanedPrice === null || Number(cleanedPrice) <= 0) {
      return res.status(400).json({ error: 'Price must be a positive number' });
    }
    if (!cleanedTaxClassId) {
      return res.status(400).json({ error: 'Tax class is required' });
    }
    if (!cleanedPrinterStationId) {
      return res.status(400).json({ error: 'Printer station is required' });
    }
    if (!['exclusive', 'inclusive'].includes(cleanedPriceType)) {
      return res.status(400).json({ error: 'Price type must be either exclusive or inclusive' });
    }

    const category = await prisma.posMenuCategory.findUnique({
      where: { id: Number(cleanedCategoryId) },
    });

    if (!category) {
      return res.status(400).json({ error: 'Selected category not found' });
    }
    if (category.level !== 3) {
      return res.status(400).json({ error: 'Menu items can only be assigned to a family group (Level 3)'});
    }

    const item = await prisma.posMenuItem.create({
      data: {
        name: cleanedName,
        categoryId: Number(cleanedCategoryId),
        defaultRate: Number(cleanedPrice),
        priceType: cleanedPriceType,
        taxClassId: Number(cleanedTaxClassId),
        printerStationId: Number(cleanedPrinterStationId),
        isActive: cleanedIsActive,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      include: { category: true, taxClass: true },
    });

    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tax-classes', async (_req, res) => {
  try {
    const taxClasses = await prisma.posTaxClass.findMany({
      orderBy: { name: 'asc' },
      include: { taxes: { include: { tax: true } } },
    });
    res.json(taxClasses);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/printer-stations', async (_req, res) => {
  try {
    const stations = await prisma.posPrinterStation.findMany({
      orderBy: { name: 'asc' },
      include: { outlet: true },
    });
    res.json(stations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/menu-items/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'menu item id');
    const { categoryId, name, defaultRate, taxClassId, printerStationId, isSetMenu, isActive, imageUrl, sortOrder, barCode, priceType, price_type } = req.body;
    const cleanedPriceType = priceType === undefined && price_type === undefined ? undefined : String(priceType ?? price_type ?? 'exclusive').toLowerCase();
    if (cleanedPriceType && !['exclusive', 'inclusive'].includes(cleanedPriceType)) {
      return res.status(400).json({ error: 'Price type must be either exclusive or inclusive' });
    }

    const item = await prisma.posMenuItem.update({
      where: { id },
      data: {
        categoryId: categoryId === undefined ? undefined : Number(categoryId),
        name,
        defaultRate: defaultRate === undefined ? undefined : Number(defaultRate),
        priceType: cleanedPriceType,
        taxClassId: taxClassId === undefined ? undefined : taxClassId ? Number(taxClassId) : null,
        printerStationId: printerStationId === undefined ? undefined : printerStationId ? Number(printerStationId) : null,
        isSetMenu,
        isActive,
        imageUrl: imageUrl === undefined ? undefined : imageUrl || null,
        sortOrder: sortOrder === undefined ? undefined : Number(sortOrder),
        barCode: barCode === undefined ? undefined : barCode || null,
      },
    });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/menu-items/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'menu item id');
    await prisma.posMenuItem.update({
      where: { id },
      data: { isActive: false },
    });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Outlets
router.get('/outlets', async (_req, res) => {
  try {
    const outlets = await prisma.posOutlet.findMany({
      include: { tables: true },
      orderBy: { name: 'asc' },
    });
    res.json(outlets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Migration helper endpoints (admin)
router.get('/migration/status', async (_req, res) => {
  try {
    // categories that likely were created by migration (name patterns) or still have '(migrated)'
    const migratedCats = await prisma.posMenuCategory.findMany({ where: { OR: [ { name: { contains: '(migrated)' } }, { name: { endsWith: ' - Master' } }, { name: { endsWith: ' - Family' } } ] }, orderBy: { level: 'asc' } });
    const items = await prisma.posMenuItem.findMany({ select: { id: true, name: true, categoryId: true } });
    res.json({ migratedCats, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/migration/mapping', async (_req, res) => {
  try {
    const fs = require('fs');
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd).filter(f => f.startsWith('migration-mapping-') && f.endsWith('.json'));
    if (files.length === 0) return res.status(404).json({ error: 'No migration mapping found' });
    files.sort();
    const latest = files[files.length -1];
    const mapping = JSON.parse(fs.readFileSync(require('path').join(cwd, latest), 'utf8'));
    res.json({ mappingFile: latest, mapping });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/migration/generate-mapping', async (_req, res) => {
  try {
    // run the mapping generator script programmatically
    const gen = require('../../generateMigrationMapping');
    // The generator script is a standalone CLI; instead of importing, spawn it synchronously
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, [require('path').join(process.cwd(), 'generateMigrationMapping.js')], { encoding: 'utf8' });
    res.json({ ok: true, out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/migration/rename', async (_req, res) => {
  try {
    const migrated = await prisma.posMenuCategory.findMany({ where: { name: { contains: '(migrated)' } } });
    const updates = [];
    for (const c of migrated) {
      const newName = c.name.replace(/\s*\(migrated\)\s*$/i, '').trim();
      await prisma.posMenuCategory.update({ where: { id: c.id }, data: { name: newName } });
      updates.push({ id: c.id, oldName: c.name, newName });
    }
    res.json({ renamed: updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/migration/reassign', async (req, res) => {
  try {
    const { itemId, familyId } = req.body;
    if (!itemId || !familyId) return res.status(400).json({ error: 'itemId and familyId are required' });
    const family = await prisma.posMenuCategory.findUnique({ where: { id: Number(familyId) } });
    if (!family || family.level !== 3) return res.status(400).json({ error: 'Target must be a Family group (level 3)' });
    const item = await prisma.posMenuItem.update({ where: { id: Number(itemId) }, data: { categoryId: family.id } });
    res.json({ updated: item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/migration/bulk-rename', async (req, res) => {
  try {
    const { renames } = req.body; // array of { id, newName }
    if (!Array.isArray(renames)) return res.status(400).json({ error: 'renames array required' });
    const results = [];
    await prisma.$transaction(async (tx) => {
      for (const r of renames){
        const id = Number(r.id);
        const newName = typeof r.newName === 'string' ? r.newName.trim() : '';
        if (!id || !newName) continue;
        const updated = await tx.posMenuCategory.update({ where: { id }, data: { name: newName } });
        results.push({ id, oldName: r.oldName || null, newName: updated.name });
      }
    });
    res.json({ renamed: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/migration/revert', async (req, res) => {
  try {
    const dry = req.body?.dry === true || req.query?.dry === 'true';
    const fs = require('fs');
    const cwd = process.cwd();

    // prefer mapping if available
    const mappingFiles = fs.readdirSync(cwd).filter(f => f.startsWith('migration-mapping-') && f.endsWith('.json'));
    if (mappingFiles.length > 0){
      mappingFiles.sort();
      const latest = mappingFiles[mappingFiles.length -1];
      const mapping = JSON.parse(fs.readFileSync(require('path').join(cwd, latest), 'utf8'));
      if (dry){
        return res.json({ dryRun: true, mappingFile: latest, actions: { items: mapping.itemMappings.length, entries: mapping.entries.length } });
      }
      await prisma.$transaction(async (tx) => {
        for (const item of mapping.itemMappings){
          if (item.originalCategoryId) await tx.posMenuItem.update({ where: { id: item.itemId }, data: { categoryId: item.originalCategoryId } });
        }
        for (const e of mapping.entries){
          if (e.familyId) try{ await tx.posMenuCategory.delete({ where: { id: e.familyId } }); } catch(_){}
          if (e.masterId) try{ await tx.posMenuCategory.delete({ where: { id: e.masterId } }); } catch(_){}
        }
      });
      return res.json({ revertedUsing: latest });
    }

    // fallback: use latest backup
    const backups = fs.readdirSync(cwd).filter(f => f.startsWith('migration-backup-') && f.endsWith('.json'));
    if (backups.length === 0) return res.status(400).json({ error: 'No mapping or backup found' });
    backups.sort();
    const latestBackup = backups[backups.length -1];
    const backup = JSON.parse(fs.readFileSync(require('path').join(cwd, latestBackup), 'utf8'));

    if (dry){
      return res.json({ dryRun: true, backupFile: latestBackup, actions: { items: backup.items.length } });
    }

    await prisma.$transaction(async (tx) => {
      for (const it of backup.items) {
        if (it.categoryId) await tx.posMenuItem.update({ where: { id: it.id }, data: { categoryId: it.categoryId } });
      }
      const migratedCats = await tx.posMenuCategory.findMany({ where: { name: { contains: '(migrated)' } } });
      for (const mc of migratedCats) await tx.posMenuCategory.delete({ where: { id: mc.id } });
    });

    res.json({ revertedUsing: latestBackup });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/outlets', async (req, res) => {
  try {
    const { name, location, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const outlet = await prisma.posOutlet.create({ data: { name, location, description } });
    res.status(201).json(outlet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/outlets/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'outlet id');
    const outlet = await prisma.posOutlet.update({
      where: { id },
      data: req.body,
    });
    res.json(outlet);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/outlets/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'outlet id');
    await prisma.posOutlet.update({
      where: { id },
      data: { isActive: false },
    });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tables
router.get('/tables', async (_req, res) => {
  try {
    const tables = await prisma.posTable.findMany({
      include: { outlet: true },
      orderBy: [{ outletId: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tables', async (req, res) => {
  try {
    const { outletId, sectionId, name, seats, sortOrder, status } = req.body;
    if (!outletId || !name) return res.status(400).json({ error: 'outletId and name are required' });

    const table = await prisma.posTable.create({
      data: {
        outletId: Number(outletId),
        sectionId: sectionId ? Number(sectionId) : null,
        name,
        seats: seats ?? 4,
        sortOrder: sortOrder ?? 0,
        status: status || 'free',
      },
    });
    res.status(201).json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tables/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'table id');
    const table = await prisma.posTable.update({
      where: { id },
      data: {
        ...req.body,
        outletId: req.body.outletId ? Number(req.body.outletId) : undefined,
        sectionId: req.body.sectionId === undefined ? undefined : req.body.sectionId ? Number(req.body.sectionId) : null,
      },
    });
    res.json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tables/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'table id');
    await prisma.posTable.delete({ where: { id } });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Waiters
router.get('/waiters', async (_req, res) => {
  try {
    const waiters = await prisma.posWaiter.findMany({
      orderBy: { name: 'asc' },
    });
    res.json(waiters);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/waiters', async (req, res) => {
  try {
    const { code, name, isActive } = req.body;
    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });

    const waiter = await prisma.posWaiter.create({ data: { code, name, isActive: isActive ?? true } });
    res.status(201).json(waiter);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/waiters/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'waiter id');
    const waiter = await prisma.posWaiter.update({
      where: { id },
      data: req.body,
    });
    res.json(waiter);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/waiters/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'waiter id');
    await prisma.posWaiter.update({ where: { id }, data: { isActive: false } });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function serializeTaxClassRates(taxClass) {
  return {
    ...taxClass,
    rates: (taxClass.taxes || []).map((link) => ({
      id: link.id,
      taxId: link.taxId,
      name: link.tax?.name || 'Untitled rate',
      percentage: Number(link.tax?.rate ?? 0),
      rate: Number(link.tax?.rate ?? 0),
      description: link.tax?.description || null,
      isActive: link.tax?.isActive ?? true,
    })),
  };
}

// TAXS -- list and create taxes (admin)
router.get('/taxes', async (_req, res) => {
  try {
    const taxes = await prisma.posTax.findMany({ orderBy: { name: 'asc' } });
    res.json(taxes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create a tax; optional taxClassId will link the tax to a class
router.post('/taxes', async (req, res) => {
  try {
    const { name, rate, description, isActive, taxClassId } = req.body;
    if (!name || name.trim() === '') return res.status(400).json({ error: 'name is required' });
    if (rate === undefined || rate === null || Number(rate) < 0) return res.status(400).json({ error: 'rate is required and must be >= 0' });

    const tax = await prisma.posTax.create({
      data: { name: name.trim(), rate: Number(rate), description: description || null, isActive: isActive ?? true },
    });

    if (taxClassId) {
      await prisma.posTaxClassTax.create({ data: { taxClassId: Number(taxClassId), taxId: tax.id } });
    }

    res.status(201).json(tax);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Tax classes & rates
router.get('/tax-classes', async (_req, res) => {
  try {
    const taxClasses = await prisma.posTaxClass.findMany({
      include: { taxes: { include: { tax: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(taxClasses.map(serializeTaxClassRates));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tax-classes/:id/rates', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'tax class id');
    const taxClass = await prisma.posTaxClass.findUnique({
      where: { id },
      include: { taxes: { include: { tax: true } } },
    });
    if (!taxClass) return res.status(404).json({ error: 'Tax class not found' });
    res.json(taxClass.taxes.map(link => ({
      id: link.id,
      taxId: link.taxId,
      name: link.tax?.name || 'Untitled rate',
      percentage: Number(link.tax?.rate ?? 0),
      rate: Number(link.tax?.rate ?? 0),
      description: link.tax?.description || null,
      isActive: link.tax?.isActive ?? true,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tax-classes', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const taxClass = await prisma.posTaxClass.create({ data: { name } });
    res.status(201).json(serializeTaxClassRates(taxClass));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tax-rates', async (req, res) => {
  try {
    const { taxClassId, name, percentage } = req.body;
    if (!taxClassId) return res.status(400).json({ error: 'taxClassId is required' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    if (percentage === undefined || percentage === null || Number(percentage) < 0) {
      return res.status(400).json({ error: 'percentage is required and must be >= 0' });
    }

    const taxClass = await prisma.posTaxClass.findUnique({ where: { id: Number(taxClassId) } });
    if (!taxClass) return res.status(404).json({ error: 'Tax class not found' });

    const value = Number(percentage);
    const tax = await prisma.posTax.create({
      data: {
        name: String(name).trim(),
        rate: value,
        description: null,
        isActive: true,
      },
    });

    const link = await prisma.posTaxClassTax.create({
      data: { taxClassId: Number(taxClassId), taxId: tax.id },
      include: { tax: true },
    });

    res.status(201).json({
      id: link.id,
      taxId: tax.id,
      taxClassId: Number(taxClassId),
      name: link.tax.name,
      percentage: Number(link.tax.rate),
      rate: Number(link.tax.rate),
      description: link.tax.description,
      isActive: link.tax.isActive,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tax-rates/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'tax rate id');
    const link = await prisma.posTaxClassTax.findUnique({
      where: { id },
      include: { tax: true },
    });
    if (!link) return res.status(404).json({ error: 'Tax rate not found' });

    await prisma.posTaxClassTax.delete({ where: { id } });
    const remainingLinks = await prisma.posTaxClassTax.count({ where: { taxId: link.taxId } });
    if (remainingLinks === 0) {
      await prisma.posTax.delete({ where: { id: link.taxId } });
    }

    res.json({ success: true, id, taxId: link.taxId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/tax-classes/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'tax class id');
    const taxClass = await prisma.posTaxClass.update({
      where: { id },
      data: req.body,
    });
    res.json(taxClass);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/tax-classes/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'tax class id');
    await prisma.posTaxClass.delete({ where: { id } });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Discounts - config-like list from discount application records
router.get('/discounts', async (_req, res) => {
  try {
    const discounts = await prisma.posOrderDiscount.findMany({
      orderBy: { appliedAt: 'desc' },
      take: 50,
    });
    res.json(discounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/discounts', async (req, res) => {
  try {
    const { orderId, valueType, value, remark, appliedBy } = req.body;
    if (!orderId || value == null) {
      return res.status(400).json({ error: 'orderId and value are required' });
    }

    const discount = await prisma.posOrderDiscount.create({
      data: {
        orderId: Number(orderId),
        valueType: valueType || 'percentage',
        value: Number(value),
        remark: remark || null,
        appliedBy: Number(appliedBy || 0),
      },
    });
    res.status(201).json(discount);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Printer stations
router.get('/printer-stations', async (_req, res) => {
  try {
    const stations = await prisma.posPrinterStation.findMany({
      where: { isActive: true },
      include: { outlet: true },
      orderBy: [{ outletId: 'asc' }, { name: 'asc' }],
    });
    res.json(stations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/printer-stations', async (req, res) => {
  try {
    const { outletId, name, printerType, isActive } = req.body;
    if (!outletId || !name) return res.status(400).json({ error: 'outletId and name are required' });

    const station = await prisma.posPrinterStation.create({
      data: {
        outletId: Number(outletId),
        name,
        printerType: printerType ?? 0,
        isActive: isActive ?? true,
      },
      include: { outlet: true },
    });
    res.status(201).json(station);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/printer-stations/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'printer station id');
    const station = await prisma.posPrinterStation.update({
      where: { id },
      data: req.body,
      include: { outlet: true },
    });
    res.json(station);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/printer-stations/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'printer station id');
    await prisma.posPrinterStation.update({
      where: { id },
      data: { isActive: false },
    });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Users - admin-only user management from shared Ella PMS users table
router.get('/users', async (_req, res) => {
  try {
    const users = await ellaPrisma.$queryRaw`
      SELECT id, username, full_name, email, role, is_active, created_at, updated_at
      FROM users
      ORDER BY username ASC
    `;
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', async (req, res) => {
  try {
    const { username, password, fullName, role, email } = req.body;
    if (!username || !password || !fullName) {
      return res.status(400).json({ error: 'username, password, and fullName are required' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const rows = await ellaPrisma.$queryRaw`
      INSERT INTO users (username, password_hash, full_name, email, role, is_active)
      VALUES (${username}, ${passwordHash}, ${fullName}, ${email || null}, ${role || 'front_office'}, 1)
    `;
    res.status(201).json({ success: true, affectedRows: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'user id');
    const { username, fullName, role, email, isActive, password } = req.body;
    let passwordHash = undefined;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const updated = await ellaPrisma.$queryRaw`
      UPDATE users
      SET username = COALESCE(${username}, username),
          full_name = COALESCE(${fullName}, full_name),
          email = COALESCE(${email}, email),
          role = COALESCE(${role}, role),
          is_active = COALESCE(${isActive}, is_active),
          password_hash = COALESCE(${passwordHash}, password_hash)
      WHERE id = ${id}
    `;
    res.json({ success: true, affectedRows: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id, 'user id');
    const result = await ellaPrisma.$queryRaw`
      UPDATE users SET is_active = 0 WHERE id = ${id}
    `;
    res.json({ success: true, affectedRows: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
