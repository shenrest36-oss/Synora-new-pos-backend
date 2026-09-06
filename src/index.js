require('dotenv').config();
const express = require('express');
const cors = require('cors');
const prisma = require('./prismaClient');

const app = express();
const PORT = process.env.PORT || 5001;

async function ensureMenuItemPriceTypeColumn() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'pos_menu_items'
        AND column_name = 'price_type'
      LIMIT 1;
    `;

    if (rows.length === 0) {
      await prisma.$executeRaw`ALTER TABLE pos_menu_items ADD COLUMN price_type VARCHAR(16) NOT NULL DEFAULT 'exclusive';`;
      console.log('Added missing pos_menu_items.price_type column');
    }
  } catch (error) {
    console.warn('Unable to verify menu item schema:', error.message);
  }
}

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api/pos/outlets',      require('./routes/pos.outlets'));
app.use('/api/pos/tables',       require('./routes/pos.tables'));
app.use('/api/pos/menu',         require('./routes/pos.menu'));
app.use('/api/pos/orders',       require('./routes/pos.orders'));
app.use('/api/pos/bills',        require('./routes/pos.bills'));
app.use('/api/pos/payments',     require('./routes/pos.payments'));
app.use('/api/pos/guests',       require('./routes/pos.guests'));
app.use('/api/pos/reports',      require('./routes/pos.reports'));
app.use('/api/pos/config',       require('./routes/pos.config'));
app.use('/api/pos/backoffice',   require('./routes/pos.backoffice'));
app.use('/api/auth',             require('./routes/auth'));

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'kotbot-pos' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

async function startServer() {
  await ensureMenuItemPriceTypeColumn();

  app.listen(PORT, () => {
    console.log(`KOT-BOT POS API running on port ${PORT}`);
  }).on('error', err => {
    if (err.code === 'EADDRINUSE') {
        const alt = PORT + 1;
        console.warn(`Port ${PORT} in use, switching to ${alt}`);
        app.listen(alt, () => console.log(`KOT-BOT POS API running on port ${alt}`));
    } else {
        throw err;
    }
  });
}

startServer();
