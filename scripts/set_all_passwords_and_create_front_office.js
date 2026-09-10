const ellaPrisma = require('../src/ellaPrismaClient');
const bcrypt = require('bcryptjs');

async function main() {
  try {
    console.log('Hashing password "123"...');
    const hash = await bcrypt.hash('123', 10);
    console.log('Updating all users to new password hash...');
    await ellaPrisma.$executeRaw`
      UPDATE users SET password_hash = ${hash}, updated_at = NOW();
    `;
    console.log('All user passwords updated.');

    const username = 'front_office';
    const fullName = 'Front Office User';
    const email = 'front_office@local.test';
    const role = 'front_office';

    console.log(`Checking for existing user with username=${username}...`);
    const existing = await ellaPrisma.$queryRaw`
      SELECT id FROM users WHERE username = ${username} LIMIT 1;
    `;

    if (existing && existing.length > 0) {
      console.log('User exists — updating role and password...');
      await ellaPrisma.$executeRaw`
        UPDATE users
        SET password_hash = ${hash}, role = ${role}, full_name = ${fullName}, email = ${email}, is_active = 1, updated_at = NOW()
        WHERE username = ${username};
      `;
      console.log('User updated.');
    } else {
      console.log('User not found — inserting new user...');
      await ellaPrisma.$executeRaw`
        INSERT INTO users (username, password_hash, full_name, email, role, role_id, is_active, created_at, updated_at)
        VALUES (${username}, ${hash}, ${fullName}, ${email}, ${role}, NULL, 1, NOW(), NOW());
      `;
      console.log('User created.');
    }

    console.log('Done.');
  } catch (err) {
    console.error('Script error:', err);
    process.exit(2);
  } finally {
    await ellaPrisma.$disconnect();
  }
}

main();
