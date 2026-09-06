require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  try{
    // find latest backup
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd).filter(f => f.startsWith('migration-backup-') && f.endsWith('.json'));
    if (files.length === 0) {
      console.error('No backup files found');
      process.exit(1);
    }
    files.sort();
    const latestBackup = files[files.length -1];
    const backup = JSON.parse(fs.readFileSync(path.join(cwd, latestBackup), 'utf8'));

    // find masters and families created by migration (naming pattern)
    const cats = await prisma.posMenuCategory.findMany({ select: { id: true, name: true, level: true, parentId: true } });

    // map majors by id
    const majorsMap = new Map(backup.majors.map(m => [m.id, m]));

    // Find created masters and families by name pattern "<MajorName> - Master" and "<MajorName> - Family"
    const mappingEntries = [];
    for (const major of backup.majors){
      const masterName = `${major.name} - Master`;
      const familyName = `${major.name} - Family`;
      const master = cats.find(c => c.name === masterName && c.level === 2 && c.parentId === major.id);
      const family = cats.find(c => c.name === familyName && c.level === 3 && master && c.parentId === master.id);
      mappingEntries.push({ majorId: major.id, majorName: major.name, masterId: master ? master.id : null, familyId: family ? family.id : null });
    }

    // items mapping: items in backup had original categoryId (major). Find which new family they moved to (current DB)
    const items = await prisma.posMenuItem.findMany({ select: { id: true, name: true, categoryId: true } });
    const itemMap = new Map(items.map(i => [i.id, i]));
    const itemMappings = backup.items.map(it => {
      const current = itemMap.get(it.id);
      return { itemId: it.id, itemName: it.name, originalCategoryId: it.categoryId, newCategoryId: current ? current.categoryId : null };
    });

    const mapping = {
      generatedAt: new Date().toISOString(),
      backupFile: latestBackup,
      entries: mappingEntries,
      itemMappings,
    };

    const outName = `migration-mapping-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
    fs.writeFileSync(path.join(cwd, outName), JSON.stringify(mapping, null, 2), 'utf8');
    console.log('Mapping written to', outName);
  }catch(e){
    console.error('ERROR', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
