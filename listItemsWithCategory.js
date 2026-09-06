require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  try{
    const items = await prisma.posMenuItem.findMany({ select: { id: true, name: true, categoryId: true } });
    const cats = await prisma.posMenuCategory.findMany({ select: { id: true, name: true, level: true } });
    const catMap = new Map(cats.map(c => [c.id, c]));
    const out = items.map(it => ({ id: it.id, name: it.name, categoryId: it.categoryId, categoryLevel: catMap.get(it.categoryId)?.level ?? null, categoryName: catMap.get(it.categoryId)?.name ?? null }));
    console.log(JSON.stringify(out, null, 2));
  }catch(e){
    console.error('ERROR', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
