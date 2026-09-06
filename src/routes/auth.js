const express = require('express');
const router = express.Router();
const prisma = require('../ellaPrismaClient');

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

/**
 * POST /api/auth/login
 * Authenticates against ella_pms.users — identical to Ella PMS login.
 * The POS and Ella PMS share the same JWT_SECRET so a token issued by
 * either system works in both.
 */
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password are required' });

    // Query ella_pms users table via raw SQL (Prisma model lives in Ella PMS schema,
    // but same DB — so $queryRaw works fine)
    const users = await prisma.$queryRaw`
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
