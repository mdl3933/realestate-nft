const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_DIR = path.join(__dirname, '../data');
const DB_PATH = path.join(DB_DIR, 'estate.sqlite');

if (!require('fs').existsSync(DB_DIR)) {
  require('fs').mkdirSync(DB_DIR, { recursive: true });
}

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open SQLite database:', err.message);
    process.exit(1);
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      wallet_address TEXT UNIQUE NOT NULL,
      encrypted_private_key TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS properties (
      id TEXT PRIMARY KEY,
      token_id INTEGER UNIQUE NOT NULL,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT,
      image_uri TEXT,
      total_shares INTEGER DEFAULT 0,
      is_fractionalized INTEGER DEFAULT 0,
      owner_address TEXT NOT NULL,
      tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_id INTEGER NOT NULL,
      seller_address TEXT NOT NULL,
      token_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      price_per_share_wei TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      tx_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_properties_token_id ON properties(token_id)`);
});

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    wallet_address: row.wallet_address,
    created_at: row.created_at,
  };
}

function mapUserFull(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    password_hash: row.password_hash,
    wallet_address: row.wallet_address,
    encrypted_private_key: row.encrypted_private_key,
    created_at: row.created_at,
  };
}

function mapProperty(row) {
  if (!row) return null;
  return {
    id: row.id,
    token_id: row.token_id,
    name: row.name,
    location: row.location,
    description: row.description,
    image_uri: row.image_uri,
    total_shares: row.total_shares,
    is_fractionalized: Boolean(row.is_fractionalized),
    owner_address: row.owner_address,
    tx_hash: row.tx_hash,
    created_at: row.created_at,
  };
}

function mapOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    order_id: row.order_id,
    seller_address: row.seller_address,
    token_id: row.token_id,
    amount: row.amount,
    price_per_share_wei: row.price_per_share_wei,
    active: Boolean(row.active),
    tx_hash: row.tx_hash,
    created_at: row.created_at,
  };
}

module.exports = {
  async createUser({ id, username, passwordHash, walletAddress, encryptedPrivateKey }) {
    const sql = `
      INSERT INTO users (id, username, password_hash, wallet_address, encrypted_private_key)
      VALUES (?, ?, ?, ?, ?)
    `;
    await runAsync(sql, [id, username, passwordHash, walletAddress.toLowerCase(), encryptedPrivateKey]);
    return mapUserFull(await getAsync('SELECT * FROM users WHERE id = ?', [id]));
  },

  async getUserById(id) {
    const row = await getAsync('SELECT * FROM users WHERE id = ?', [id]);
    return mapUser(row);
  },

  async getFullUserById(id) {
    const row = await getAsync('SELECT * FROM users WHERE id = ?', [id]);
    return mapUserFull(row);
  },

  async getUserByUsername(username) {
    const row = await getAsync('SELECT * FROM users WHERE username = ?', [username]);
    return mapUserFull(row);
  },

  async getUserByWallet(walletAddress) {
    const row = await getAsync('SELECT * FROM users WHERE wallet_address = ?', [walletAddress.toLowerCase()]);
    return mapUser(row);
  },

  async createProperty({ id, tokenId, name, location, description, imageUri, ownerAddress, txHash }) {
    const sql = `
      INSERT INTO properties (id, token_id, name, location, description, image_uri, owner_address, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await runAsync(sql, [id, tokenId, name, location, description || '', imageUri || '', ownerAddress.toLowerCase(), txHash]);
    return mapProperty(await getAsync('SELECT * FROM properties WHERE id = ?', [id]));
  },

  async listProperties() {
    const rows = await allAsync('SELECT * FROM properties ORDER BY created_at DESC');
    return rows.map(mapProperty);
  },

  async updatePropertyFractionalized(tokenId, totalShares) {
    await runAsync(
      'UPDATE properties SET is_fractionalized = 1, total_shares = ? WHERE token_id = ?',
      [totalShares, tokenId]
    );
    return mapProperty(await getAsync('SELECT * FROM properties WHERE token_id = ?', [tokenId]));
  },

  async createOrder({ id, orderId, sellerAddress, tokenId, amount, pricePerShareWei, txHash }) {
    const sql = `
      INSERT INTO orders (id, order_id, seller_address, token_id, amount, price_per_share_wei, active, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await runAsync(sql, [id, orderId, sellerAddress.toLowerCase(), tokenId, amount, String(pricePerShareWei), 1, txHash]);
    return mapOrder(await getAsync('SELECT * FROM orders WHERE id = ?', [id]));
  },

  async updateOrder(orderId, { amount, active }) {
    await runAsync(
      'UPDATE orders SET amount = ?, active = ? WHERE order_id = ?',
      [amount, active ? 1 : 0, orderId]
    );
    return mapOrder(await getAsync('SELECT * FROM orders WHERE order_id = ?', [orderId]));
  },

  async listOrders() {
    const rows = await allAsync('SELECT * FROM orders ORDER BY created_at DESC');
    return rows.map(mapOrder);
  },

  close() {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  },
};
