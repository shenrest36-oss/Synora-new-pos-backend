require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const prisma = require('./prismaClient');
const ellaPrisma = require('./ellaPrismaClient');
const { addKitchenStreamClient } = require('./services/kitchenStream');
const { authenticate } = require('./middlewares/auth');

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

async function ensureEllaPmsUsersTable() {
  try {
    const rows = await ellaPrisma.$queryRaw`
      SELECT TABLE_NAME AS table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
      LIMIT 1;
    `;

    if (rows.length === 0) {
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
        console.log(`Seeded default local user: ${user.username} / ${user.password}`);
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
        console.log(`Updated seeded local user: ${user.username}`);
      }
    }
  } catch (error) {
    console.warn('Unable to ensure Ella PMS users table:', error.message);
  }
}

async function ensureKitchenBoardSchema() {
  try {
    const rows = await prisma.$queryRaw`
      SELECT COLUMN_NAME AS column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'pos_orders';
    `;
    const columns = new Set((rows || []).map(row => (row.column_name || row.COLUMN_NAME || '').toLowerCase()));

    if (columns.has('served_at')) {
      await prisma.$executeRawUnsafe("UPDATE pos_orders SET kitchen_status = 'ready' WHERE kitchen_status = 'served';");
      await prisma.$executeRawUnsafe('ALTER TABLE pos_orders DROP COLUMN served_at;');
      console.log('Removed served stage from pos_orders kitchen tracking');
    }

    if (columns.has('kitchen_status')) {
      await prisma.$executeRawUnsafe("UPDATE pos_orders SET kitchen_status = 'ready' WHERE kitchen_status = 'served';");
      await prisma.$executeRawUnsafe("ALTER TABLE pos_orders MODIFY COLUMN kitchen_status ENUM('new', 'preparing', 'ready', 'cancelled') NOT NULL DEFAULT 'new';");
    } else {
      await prisma.$executeRawUnsafe("ALTER TABLE pos_orders ADD COLUMN kitchen_status ENUM('new', 'preparing', 'ready', 'cancelled') NOT NULL DEFAULT 'new'");
    }

    const additions = [];
    if (!columns.has('started_at')) additions.push('ADD COLUMN started_at TIMESTAMP NULL');
    if (!columns.has('ready_at')) additions.push('ADD COLUMN ready_at TIMESTAMP NULL');
    if (!columns.has('cancelled_at')) additions.push('ADD COLUMN cancelled_at TIMESTAMP NULL');
    if (!columns.has('cancelled_reason')) additions.push('ADD COLUMN cancelled_reason VARCHAR(255) NULL');

    if (additions.length > 0) {
      await prisma.$executeRawUnsafe(`ALTER TABLE pos_orders ${additions.join(', ')}`);
      console.log('Added missing pos_orders kitchen-stage columns');
    }
  } catch (error) {
    console.warn('Unable to verify kitchen board schema:', error.message);
  }
}

async function ensureSamplePosData() {
  try {
    const outletCount = await prisma.posOutlet.count();
    if (outletCount > 0) {
      return;
    }

    const outlet = await prisma.posOutlet.create({
      data: {
        name: 'Main Dining',
        location: 'Ground Floor',
        description: 'Default QA outlet for local POS testing',
      },
    });

    const section = await prisma.posSection.create({
      data: {
        outletId: outlet.id,
        name: 'Dining Hall',
        description: 'Main dining area',
      },
    });

    const tableNames = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
    for (let i = 0; i < tableNames.length; i += 1) {
      await prisma.posTable.create({
        data: {
          outletId: outlet.id,
          sectionId: section.id,
          name: tableNames[i],
          seats: 4,
          status: 'free',
          sortOrder: i + 1,
        },
      });
    }

    const food = await prisma.posMenuCategory.create({
      data: { name: 'Food', level: 1, sortOrder: 1 },
    });
    const mains = await prisma.posMenuCategory.create({
      data: { parentId: food.id, name: 'Mains', level: 2, sortOrder: 1 },
    });
    const grill = await prisma.posMenuCategory.create({
      data: { parentId: mains.id, name: 'Grill', level: 3, sortOrder: 1 },
    });
    const rice = await prisma.posMenuCategory.create({
      data: { parentId: mains.id, name: 'Rice & Bowls', level: 3, sortOrder: 2 },
    });

    const drinks = await prisma.posMenuCategory.create({
      data: { name: 'Beverages', level: 1, sortOrder: 2 },
    });
    const coldDrinks = await prisma.posMenuCategory.create({
      data: { parentId: drinks.id, name: 'Cold Drinks', level: 2, sortOrder: 1 },
    });
    const juices = await prisma.posMenuCategory.create({
      data: { parentId: coldDrinks.id, name: 'Juices', level: 3, sortOrder: 1 },
    });

    const sampleItems = [
      { categoryId: grill.id, name: 'Grilled Chicken', defaultRate: 1200 },
      { categoryId: grill.id, name: 'Fish & Chips', defaultRate: 1350 },
      { categoryId: rice.id, name: 'Chicken Rice Bowl', defaultRate: 950 },
      { categoryId: rice.id, name: 'Veggie Rice Bowl', defaultRate: 850 },
      { categoryId: juices.id, name: 'Fresh Lime Soda', defaultRate: 350 },
      { categoryId: juices.id, name: 'Mango Juice', defaultRate: 400 },
    ];

    for (const item of sampleItems) {
      await prisma.posMenuItem.create({
        data: {
          categoryId: item.categoryId,
          name: item.name,
          defaultRate: item.defaultRate,
          priceType: 'exclusive',
          sortOrder: 1,
        },
      });
    }

    console.log('Seeded default POS outlet, tables, and menu data for QA');
  } catch (error) {
    console.warn('Unable to seed sample POS data:', error.message);
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
app.use('/api/pos/kitchen',      require('./routes/pos.kitchen'));
app.use('/api/pos/bills',        require('./routes/pos.bills'));
app.use('/api/pos/payments',     require('./routes/pos.payments'));
app.use('/api/pos/guests',       require('./routes/pos.guests'));
app.use('/api/pos/reports',      require('./routes/pos.reports'));
app.use('/api/pos/config',       require('./routes/pos.config'));
app.use('/api/pos/backoffice',   require('./routes/pos.backoffice'));
app.use('/api/auth',             require('./routes/auth'));
app.get('/api/pos/kitchen/stream', authenticate, (req, res) => {
  addKitchenStreamClient(res);
});

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'kotbot-pos' }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
});

async function startServer() {
  await ensureMenuItemPriceTypeColumn();
  await ensureEllaPmsUsersTable();
  await ensureKitchenBoardSchema();
  await ensureSamplePosData();

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
