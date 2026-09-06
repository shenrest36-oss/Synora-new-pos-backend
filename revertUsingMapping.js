require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main({ dry=false } = {}){
  try{
    const cwd = process.cwd();
    const files = fs.readdirSync(cwd).filter(f => f.startsWith('migration-mapping-') && f.endsWith('.json'));
    if (files.length === 0) {
      console.error('No migration mapping found');
      process.exit(1);
    }
    files.sort();
    const latest = files[files.length -1];
    const mapping = JSON.parse(fs.readFileSync(path.join(cwd, latest), 'utf8'));
    console.log('Using mapping file:', latest);

    // Dry-run: just report
    if (dry){
      console.log('DRY RUN - actions that would be taken:');
      console.log('Items to reassign back to originalCategoryId where available (sample 20):', mapping.itemMappings.slice(0,20));
      console.log('Created category entries (master/family):', mapping.entries);
      return;
    }

    // Perform revert in transaction: move items back to originalCategoryId, delete created master/family if present
    await prisma.$transaction(async (tx) => {
      for (const item of mapping.itemMappings){
        if (item.originalCategoryId) {
          await tx.posMenuItem.update({ where: { id: item.itemId }, data: { categoryId: item.originalCategoryId } });
        }
      }
      // delete created families and masters recorded in mapping (if ids present)
      for (const e of mapping.entries){
        if (e.familyId){
          try{ await tx.posMenuCategory.delete({ where: { id: e.familyId } }); } catch(err){ /* ignore if used */ }
        }
        if (e.masterId){
          try{ await tx.posMenuCategory.delete({ where: { id: e.masterId } }); } catch(err){ /* ignore if used */ }
        }
      }
    });

    console.log('Revert completed using mapping', latest);
  }catch(e){
    console.error('ERROR during revert:', e.message);
    process.exit(1);
  } finally{
    await prisma.$disconnect();
  }
}

// CLI support: node revertUsingMapping.js [--dry]
const dry = process.argv.includes('--dry');
main({ dry }).catch(()=>process.exit(1));
