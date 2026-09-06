require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  try{
    const cats = await prisma.posMenuCategory.findMany({ select: { id: true, name: true, level: true, parentId: true }, orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] });
    const items = await prisma.posMenuItem.findMany({ select: { id: true, name: true, categoryId: true } });
    const catMap = new Map(cats.map(c => [c.id, c]));
    const itemsWithCat = items.map(it => ({ id: it.id, name: it.name, categoryId: it.categoryId, categoryName: catMap.get(it.categoryId)?.name ?? null, categoryLevel: catMap.get(it.categoryId)?.level ?? null }));
    console.log('CATEGORIES:\n', JSON.stringify(cats, null, 2));
    console.log('\nITEMS WITH CATEGORY INFO:\n', JSON.stringify(itemsWithCat, null, 2));
  }catch(e){
    console.error('ERROR', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
