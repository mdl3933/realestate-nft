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
if (!db.sessions) db.sessions = {};

// 内存会话：token -> { username, signer }
const sessions = new Map();
function makeToken() { return crypto.randomBytes(24).toString('hex'); }

// ---------- 会话持久化（后端重启免登录）----------
// 用服务器主密钥(AES-256-GCM)加密缓存的私钥；主密钥存于 data/.masterkey（已 gitignore，不上传）
const MASTER_KEY_FILE = path.join(DATA_DIR, '.masterkey');
function getMasterKey() {
  try { return fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim(); }
  catch { const k = crypto.randomBytes(32).toString('hex'); fs.writeFileSync(MASTER_KEY_FILE, k, { mode: 0o600 }); return k; }
}
const MASTER_KEY = getMasterKey();
function encSecret(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(MASTER_KEY, 'hex'), iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + cipher.getAuthTag().toString('hex') + ':' + ct.toString('hex');
}
function decSecret(payload) {
  const parts = payload.split(':');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(MASTER_KEY, 'hex'), Buffer.from(parts[0], 'hex'));
  d.setAuthTag(Buffer.from(parts[1], 'hex'));
  return Buffer.concat([d.update(Buffer.from(parts[2], 'hex')), d.final()]).toString('utf8');
}
function persistSession(token, username, signer) {
  db.sessions[token] = { username, encKey: encSecret(signer.privateKey), createdAt: Date.now() };
  saveDB(db);
}
function restoreSessions() {
  let n = 0;
  for (const [token, s] of Object.entries(db.sessions || {})) {
    try { sessions.set(token, { username: s.username, signer: chain.signerFromKey(decSecret(s.encKey)) }); n++; }
    catch { /* 节点未就绪/密钥失效，鉴权时会要求重新登录 */ }
  }
  return n;
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  let sess = token && sessions.get(token);
  if (!sess && token && db.sessions && db.sessions[token]) {
    // 后端重启后：用持久化的加密私钥重建签名者
    try {
      const rec = db.sessions[token];
      sess = { username: rec.username, signer: chain.signerFromKey(decSecret(rec.encKey)) };
      sessions.set(token, sess);
    } catch { return res.status(401).json({ error: '会话已过期，请重新登录' }); }
  }
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
    persistSession(token, username, signer);
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
    persistSession(token, username, signer);
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

// ---------- 退出登录：清除内存会话与持久化会话 ----------
app.post('/api/auth/logout', (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    sessions.delete(token);
    if (db.sessions && db.sessions[token]) { delete db.sessions[token]; saveDB(db); }
  }
  res.json({ ok: true });
});

app.get('/api/orders', (req, res) => {
  const username = req.query.username || req.headers['x-username'];
  const list = username ? db.orders.filter((o) => o.owner === username) : db.orders;
  res.json({ orders: list });
});

// ---------- 订单导出 CSV（带 BOM，Excel 直接打开不乱码）----------
const TYPE_CN = { buy: '买入', sell: '卖出', split: '拆分', redeem: '赎回', claim: '分红', subscribe: '认购' };
const STATUS_CN = { filled: '已成交', pending: '链上确认中', failed: '失败' };
function csvCell(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function ordersToCsv(list) {
  const head = ['订单号', '用户', '钱包地址', '类型', '房产标识', '房产名称', '单价(元)', '数量', '总额(元)', '状态', '链上交易哈希', '时间', '备注'];
  const rows = list.map((o) => [
    o.id, o.owner, o.address || '', TYPE_CN[o.type] || o.type, o.property || '', o.propertyName || '',
    o.price || 0, o.amount || 0, o.total || 0, STATUS_CN[o.status] || o.status || '',
    o.tx || o.txHash || '', new Date(o.createdAt).toLocaleString('zh-CN', { hour12: false }), o.note || o.error || ''
  ]);
  return '\uFEFF' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
app.get('/api/orders/export', (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const sess = token && sessions.get(token);
  let list;
  if (sess) list = db.orders.filter((o) => o.owner === sess.username);
  else {
    const username = req.query.username || req.headers['x-username'];
    list = username ? db.orders.filter((o) => o.owner === username) : db.orders;
  }
  const fname = 'estate-orders-' + new Date().toISOString().slice(0, 10) + '.csv';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(fname));
  res.send(ordersToCsv(list));
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
    const restored = restoreSessions();
    if (restored) console.log('[会话] 已恢复 ' + restored + ' 个登录会话（重启免登录）');
  } catch (e) {
    console.warn('[区块链] ' + e.message);
    console.warn('[提示] 请先在 realestate-nft-contracts 执行: npx hardhat node  然后  npx hardhat run scripts/deploy-local.js --network localhost');
  }
  app.listen(PORT, () => {
    console.log('\n[ESTATE 后端] 已启动: http://127.0.0.1:' + PORT);
    console.log('[前端入口]   http://127.0.0.1:' + PORT + '/pages/index.html');
  });
})();
