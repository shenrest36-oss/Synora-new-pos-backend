const express = require('express');
const router = express.Router();
const ellaPrisma = require('../ellaPrismaClient');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function ensureEllaPmsUsersTable() {
 try {
   const tables = await ellaPrisma.$queryRaw`
     SELECT TABLE_NAME AS table_name
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = 'users'
     LIMIT 1;
   `;

   if (tables.length === 0) {
     await ellaPrisma.$executeRaw`
       CREATE TABLE IF NOT EXISTS users (
         id INT NOT NULL AUTO_INCREMENT,
         username VARCHAR(100) NOT NULL,
         password_hash VARCHAR(255) NOT NULL,
         full_name VARCHAR(150) NULL,
         email VARCHAR(150) NULL,
         role VARCHAR(50) NOT NULL DEFAULT 'waiter',
         role_id INT NULL,
         is_active TINYINT(1) NOT NULL DEFAULT 1,
         created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
         updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
         PRIMARY KEY (id),
         UNIQUE KEY uk_users_username (username)
       );
     `;
   }

   const seededUsers = [
     { username: 'admin', password: 'admin123', role: 'admin', fullName: 'System Administrator', email: 'admin@local.test' },
     { username: 'cashier', password: 'cashier123', role: 'cashier', fullName: 'Cashier User', email: 'cashier@local.test' },
   ];

   for (const user of seededUsers) {
     const existing = await ellaPrisma.$queryRaw`
       SELECT id, password_hash, full_name, email, role, is_active
       FROM users WHERE username = ${user.username}
       LIMIT 1;
     `;
     const existingUser = existing[0];
     const passwordHash = await bcrypt.hash(user.password, 10);

     if (!existingUser) {
       await ellaPrisma.$executeRaw`
         INSERT INTO users (username, password_hash, full_name, email, role, role_id, is_active, created_at, updated_at)
         VALUES (${user.username}, ${passwordHash}, ${user.fullName}, ${user.email}, ${user.role}, NULL, 1, NOW(), NOW());
       `;
       continue;
     }

     const needsPasswordFix = !(await bcrypt.compare(user.password, existingUser.password_hash));
     if (needsPasswordFix || existingUser.role !== user.role || existingUser.full_name !== user.fullName || existingUser.email !== user.email || existingUser.is_active !== 1) {
       await ellaPrisma.$executeRaw`
         UPDATE users
         SET password_hash = ${passwordHash},
             full_name = ${user.fullName},
             email = ${user.email},
             role = ${user.role},
             is_active = 1,
             updated_at = NOW()
         WHERE username = ${user.username};
       `;
     }
   }
 } catch (error) {
   console.warn('Unable to ensure ella_pms.users table exists:', error.message);
 }
}

/**
* POST /api/auth/login
* Authenticates against ella_pms.users — identical to Ella PMS login.
* The POS and Ella PMS share the same JWT_SECRET so a token issued by
* either system works in both.
*/
router.post('/login', async (req, res) => {
 try {
   await ensureEllaPmsUsersTable();

   const { username, password } = req.body;
   if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

   const users = await ellaPrisma.$queryRaw`
     SELECT id, username, password_hash, full_name, role, role_id, is_active
     FROM users WHERE username = ${username} LIMIT 1
   `;

   const user = users[0];
   if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials' });

   const valid = await bcrypt.compare(password, user.password_hash);
   if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

   const token = jwt.sign(
     { id: Number(user.id), username: user.username, role: user.role, roleId: user.role_id ? Number(user.role_id) : null },
     process.env.JWT_SECRET,
     { expiresIn: '12h' }
   );

   res.json({
     token,
     user: {
       id: Number(user.id),
       username: user.username,
       fullName: user.full_name,
       role: user.role,
     },
   });
 } catch (err) {
   res.status(500).json({ error: err.message });
 }
});

module.exports = router;
