require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  try{
    const files = fs.readdirSync(process.cwd()).filter(f => f.startsWith('migration-backup-') && f.endsWith('.json'));
    if (files.length === 0) {
      console.error('No migration backup file found in current folder');
      process.exit(1);
    }
    files.sort();
    const latest = files[files.length - 1];
    const backup = JSON.parse(fs.readFileSync(latest, 'utf8'));
    console.log('Using backup file:', latest);

    // restore item category assignments
    await prisma.$transaction(async (tx) => {
      for (const it of backup.items) {
        if (it.categoryId) {
          await tx.posMenuItem.update({ where: { id: it.id }, data: { categoryId: it.categoryId } });
        }
      }

      // delete migrated categories (created by migration have names containing '(migrated)')
      const migratedCats = await tx.posMenuCategory.findMany({ where: { name: { contains: '(migrated)' } } });
      for (const mc of migratedCats) {
        await tx.posMenuCategory.delete({ where: { id: mc.id } });
      }
    });

    console.log('Reversion completed using', latest);
  }catch(e){
    console.error('ERROR during revert:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
