/*
 * ESTATE 后端服务
 * - 用户名 + 密码注册/登录，平台托管钱包（无需 MetaMask）
 * - 订单经托管钱包签名上链（Hardhat 本地节点）
 * - 同时托管前端静态页面，访问 http://127.0.0.1:3001/pages/ 即可全链路运行
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chain = require('./blockchain');

const app = express();
const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------- 数据存储（JSON 文件，无需原生数据库）----------
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: {}, orders: [] }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }
let db = loadDB();

// 内存会话：token -> { username, signer }
const sessions = new Map();
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const sess = token && sessions.get(token);
  if (!sess) return res.status(401).json({ error: '未登录或会话已过期，请重新登录' });
  req.username = sess.username;
  req.signer = sess.signer;
  next();
}

// ---------- 健康检查 ----------
app.get('/api/health', async (req, res) => {
  const info = await chain.chainInfo();
  res.json({ ok: true, mode: info.ok ? 'chain' : 'offline', ...info });
});

// ---------- 注册 / 登录 ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    if (db.users[username]) return res.status(409).json({ error: '用户名已存在，请直接登录' });
    const wallet = await chain.createWallet();
    const keystore = await chain.encryptWallet(wallet, password); // 用用户密码加密
    db.users[username] = { address: wallet.address, keystore, createdAt: Date.now() };
    saveDB(db);
    const signer = await chain.unlockSigner(keystore, password);
    const token = makeToken();
    sessions.set(token, { username, signer });
    res.json({ username, address: wallet.address, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    const rec = db.users[username];
    if (!rec) return res.status(404).json({ error: '用户不存在，请先注册' });
    let signer;
    try {
      signer = await chain.unlockSigner(rec.keystore, password);
    } catch {
      return res.status(401).json({ error: '密码错误' });
    }
    const token = makeToken();
    sessions.set(token, { username, signer });
    res.json({ username, address: rec.address, token });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 测试币水龙头 ----------
app.post('/api/faucet', auth, async (req, res) => {
  try {
    const rec = db.users[req.username];
    const before = await chain.balance(rec.address);
    res.json({ address: rec.address, balance: before, note: '余额低于 0.02 ETH 时，下单会自动领取测试币' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 我的信息 / 持仓 ----------
app.get('/api/me', auth, async (req, res) => {
  try {
    const rec = db.users[req.username];
    const ethBal = await chain.balance(rec.address);
    const hs = await chain.holdings(rec.address).catch(() => []);
    res.json({ username: req.username, address: rec.address, ethBalance: ethBal, holdings: hs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/holdings', auth, async (req, res) => {
  try {
    const rec = db.users[req.username];
    res.json({ holdings: await chain.holdings(rec.address) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- 订单 ----------
app.post('/api/orders', auth, async (req, res) => {
  const body = req.body || {};
  const rec = db.users[req.username];
  const order = {
    id: body.id || ('ORD' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 999)),
    owner: req.username,
    address: rec.address,
    type: body.type,
    property: body.property,
    propertyName: body.propertyName,
    price: body.price || 0,
    amount: body.amount || 1,
    total: body.total || 0,
    status: 'pending',
    createdAt: Date.now()
  };
  try {
    const result = await chain.executeOrder(order, req.signer);
    order.tx = result.txHash;
    order.status = 'filled';
    order.note = result.note;
  } catch (e) {
    order.status = 'failed';
    order.error = e.message;
  }
  db.orders.unshift(order);
  saveDB(db);
  res.json({ id: order.id, status: order.status, txHash: order.tx, address: rec.address, error: order.error, note: order.note });
});

app.get('/api/orders', (req, res) => {
  const username = req.query.username || req.headers['x-username'];
  const list = username ? db.orders.filter((o) => o.owner === username) : db.orders;
  res.json({ orders: list });
});

// ---------- 托管前端静态页面 ----------
const frontendDir = path.join(__dirname, '..', '..', 'realestate-nft-fraction');
app.use(express.static(frontendDir));
app.get('/', (req, res) => res.redirect('/pages/index.html'));

// ---------- 启动 ----------
(async () => {
  try {
    const info = await chain.init();
    console.log('[区块链] 已连接  chainId=' + info.chainId + '  admin=' + info.admin);
    console.log('[合约] EstateNFT=' + info.contracts.estateNFT);
    console.log('[合约] EstateMarket=' + info.contracts.market);
  } catch (e) {
    console.warn('[区块链] ' + e.message);
    console.warn('[提示] 请先在 realestate-nft-contracts 执行: npx hardhat node  然后  npx hardhat run scripts/deploy-local.js --network localhost');
  }
  app.listen(PORT, () => {
    console.log('\n[ESTATE 后端] 已启动: http://127.0.0.1:' + PORT);
    console.log('[前端入口]   http://127.0.0.1:' + PORT + '/pages/index.html');
  });
})();
