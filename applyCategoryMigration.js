require('dotenv').config();
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `./migration-backup-${timestamp}.json`;
  try{
    // gather current state
    const majors = await prisma.posMenuCategory.findMany({ where: { level: 1 }, select: { id: true, name: true } });
    const items = await prisma.posMenuItem.findMany({ select: { id: true, name: true, categoryId: true } });
    const backup = { timestamp, majors, items };
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf8');
    console.log('Backup written to', backupPath);

    const results = [];
    await prisma.$transaction(async (tx) => {
      for (const major of majors) {
        // ensure master exists
        let master = await tx.posMenuCategory.findFirst({ where: { parentId: major.id, level: 2 } });
        if (!master) {
          master = await tx.posMenuCategory.create({ data: { parentId: major.id, name: `${major.name} - Master (migrated)`, level: 2, sortOrder: 0 } });
        }
        // ensure family exists under master
        let family = await tx.posMenuCategory.findFirst({ where: { parentId: master.id, level: 3 } });
        if (!family) {
          family = await tx.posMenuCategory.create({ data: { parentId: master.id, name: `${major.name} - Family (migrated)`, level: 3, sortOrder: 0 } });
        }
        // move items assigned to major => family
        const moved = await tx.posMenuItem.updateMany({ where: { categoryId: major.id }, data: { categoryId: family.id } });
        results.push({ majorId: major.id, majorName: major.name, masterId: master.id, familyId: family.id, movedCount: moved.count });
      }
    });

    console.log('Migration results:', JSON.stringify(results, null, 2));
    console.log('Migration completed successfully.');
  }catch(e){
    console.error('ERROR during migration:', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
