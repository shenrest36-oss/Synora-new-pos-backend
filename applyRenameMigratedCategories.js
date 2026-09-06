require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  try{
    const migrated = await prisma.posMenuCategory.findMany({ where: { name: { contains: '(migrated)' } } });
    if (migrated.length === 0) {
      console.log('No migrated categories found');
      return;
    }

    const updates = [];
    for (const c of migrated) {
      const newName = c.name.replace(/\s*\(migrated\)\s*$/i, '').trim();
      await prisma.posMenuCategory.update({ where: { id: c.id }, data: { name: newName } });
      updates.push({ id: c.id, oldName: c.name, newName });
    }

    console.log('Renamed categories:', JSON.stringify(updates, null, 2));
  }catch(e){
    console.error('ERROR', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
