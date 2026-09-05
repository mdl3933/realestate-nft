const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ethers } = require('ethers');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const blockchain = require('./blockchain');
const { encryptPrivateKey } = require('./crypto');

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET;
const FAUCET_AMOUNT_ETH = process.env.FAUCET_AMOUNT_ETH || '0.1';

if (!JWT_SECRET) {
  console.error('JWT_SECRET is required');
  process.exit(1);
}

try {
  blockchain.initContracts();
  console.log('Blockchain contracts initialized');
  console.log('Admin wallet:', blockchain.getAdminAddress());
} catch (err) {
  console.error('Failed to initialize blockchain:', err.message);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.getUserById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    req.userFull = await db.getFullUserById(decoded.id);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

app.post(
  '/api/auth/register',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(username)) {
      return res.status(400).json({ error: 'username must be 3-32 alphanumeric characters' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    const existing = await db.getUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'username already exists' });

    const passwordHash = bcrypt.hashSync(password, 10);
    const wallet = ethers.Wallet.createRandom();
    const encryptedPrivateKey = encryptPrivateKey(wallet.privateKey);

    const userFull = await db.createUser({
      id: uuidv4(),
      username,
      passwordHash,
      walletAddress: wallet.address,
      encryptedPrivateKey,
    });

    try {
      await blockchain.fundAddress(userFull.wallet_address, FAUCET_AMOUNT_ETH);
    } catch (fundErr) {
      console.warn('Failed to fund new user wallet:', fundErr.message);
    }

    const token = signToken({ id: userFull.id, username: userFull.username });
    res.json({
      token,
      user: {
        id: userFull.id,
        username: userFull.username,
        walletAddress: userFull.wallet_address,
      },
    });
  })
);

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password required' });
    }
    const userFull = await db.getUserByUsername(username);
    if (!userFull || !bcrypt.compareSync(password, userFull.password_hash)) {
      return res.status(401).json({ error: 'invalid username or password' });
    }
    const token = signToken({ id: userFull.id, username: userFull.username });
    res.json({
      token,
      user: {
        id: userFull.id,
        username: userFull.username,
        walletAddress: userFull.wallet_address,
      },
    });
  })
);

app.get('/api/me', requireAuth, async (req, res) => {
  const full = await req.userFull;
  res.json({
    id: req.user.id,
    username: req.user.username,
    walletAddress: req.user.wallet_address,
  });
});

app.post(
  '/api/faucet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const amount = req.body.amount || FAUCET_AMOUNT_ETH;
    const result = await blockchain.fundAddress(req.user.wallet_address, String(amount));
    res.json(result);
  })
);

app.post(
  '/api/properties/mint',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, location, description, imageUri } = req.body || {};
    if (!name || !location) {
      return res.status(400).json({ error: 'name and location required' });
    }
    const userFull = await req.userFull;
    const { tokenId, txHash, tokenURI } = await blockchain.mintProperty(userFull, {
      name,
      location,
      description,
      imageUri,
    });
    const property = await db.createProperty({
      id: uuidv4(),
      tokenId,
      name,
      location,
      description,
      imageUri,
      ownerAddress: req.user.wallet_address,
      txHash,
    });
    res.json({ property: { ...property, tokenURI } });
  })
);

app.post(
  '/api/properties/fractionalize',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tokenId, totalShares } = req.body || {};
    if (tokenId == null || !totalShares) {
      return res.status(400).json({ error: 'tokenId and totalShares required' });
    }
    const userFull = await req.userFull;
    const { txHash } = await blockchain.fractionalize(userFull, tokenId, totalShares);
    const property = await db.updatePropertyFractionalized(tokenId, totalShares);
    res.json({ property: { ...property, txHash } });
  })
);

app.get(
  '/api/properties',
  requireAuth,
  asyncHandler(async (req, res) => {
    const dbProperties = await db.listProperties();
    const properties = await blockchain.getProperties(dbProperties);
    res.json({ properties });
  })
);

app.post(
  '/api/properties/redeem',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tokenId } = req.body || {};
    if (tokenId == null) return res.status(400).json({ error: 'tokenId required' });
    const userFull = await req.userFull;
    const { txHash } = await blockchain.redeem(userFull, tokenId);
    res.json({ txHash });
  })
);

app.get(
  '/api/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const orders = await blockchain.getSellOrders();
    const enriched = await Promise.all(
      orders
        .filter((o) => o.active)
        .map(async (o) => {
          const seller = await db.getUserByWallet(o.seller);
          return {
            ...o,
            sellerUsername: seller ? seller.username : o.seller,
          };
        })
    );
    res.json({ orders: enriched });
  })
);

app.post(
  '/api/orders',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tokenId, amount, pricePerShareWei } = req.body || {};
    if (tokenId == null || !amount || !pricePerShareWei) {
      return res.status(400).json({ error: 'tokenId, amount and pricePerShareWei required' });
    }
    const userFull = await req.userFull;
    const { orderId, txHash } = await blockchain.createSellOrder(userFull, tokenId, amount, pricePerShareWei);
    const order = await db.createOrder({
      id: uuidv4(),
      orderId,
      sellerAddress: req.user.wallet_address,
      tokenId,
      amount,
      pricePerShareWei,
      txHash,
    });
    res.json({ order: { ...order, orderId, amount, pricePerShareWei } });
  })
);

app.post(
  '/api/orders/:orderId/buy',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orderId } = req.params;
    const { amount } = req.body || {};
    if (!orderId || !amount) {
      return res.status(400).json({ error: 'orderId and amount required' });
    }
    const userFull = await req.userFull;
    const result = await blockchain.buyShares(userFull, orderId, amount);
    const onChain = await blockchain.getSellOrders();
    const updated = onChain.find((o) => o.orderId === String(orderId));
    if (updated) {
      await db.updateOrder(orderId, { amount: updated.amount, active: updated.active });
    }
    res.json(result);
  })
);

app.get(
  '/api/dividends/pending/:tokenId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const amount = await blockchain.getPendingDividend(req.user.wallet_address, tokenId);
    res.json({ tokenId, amount });
  })
);

app.post(
  '/api/dividends/claim/:tokenId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const userFull = await req.userFull;
    const result = await blockchain.claimDividend(userFull, tokenId);
    res.json(result);
  })
);

app.get(
  '/api/balance/:tokenId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tokenId } = req.params;
    const amount = await blockchain.getBalance(req.user.wallet_address, tokenId);
    res.json({ tokenId, amount });
  })
);

app.post(
  '/api/admin/deposit-rent',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { tokenId, amountWei } = req.body || {};
    if (tokenId == null || !amountWei) {
      return res.status(400).json({ error: 'tokenId and amountWei required' });
    }
    const result = await blockchain.depositRent(null, tokenId, amountWei);
    res.json(result);
  })
);

// ---------- 静态前端托管 ----------
const FRONTEND_DIR = path.join(__dirname, '../../realestate-nft-fraction');
app.use(express.static(FRONTEND_DIR));
// 根路径重定向到首页
app.get('/', (req, res) => res.redirect('/pages/index.html'));
app.get('/pages', (req, res) => res.redirect('/pages/index.html'));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

app.listen(PORT, () => {
  console.log(`ESTATE backend listening on http://127.0.0.1:${PORT}`);
});
