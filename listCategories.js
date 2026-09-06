require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main(){
  try{
    const res = await prisma.posMenuCategory.findMany({ select: { id: true, name: true, level: true, parentId: true }, orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }] });
    console.log(JSON.stringify(res, null, 2));
  }catch(e){
    console.error('ERROR', e.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
