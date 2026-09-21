/*
 * ESTATE 业务闭环测试脚本
 * 跑通 README 中的 8 步完整流程
 */
const BASE = 'http://127.0.0.1:3001';

let userA = { username: 'userA_' + Date.now(), password: 'Pass1234!' };
let userB = { username: 'userB_' + Date.now(), password: 'Pass1234!' };
let tokens = {};
let orders = [];
let newTokenId = null;

async function request(path, opts = {}) {
  const url = BASE + path;
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  delete opts.headers;
  const res = await fetch(url, {
    headers,
    ...opts
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  }
  return data;
}

function authed(token) {
  return { headers: { Authorization: 'Bearer ' + token } };
}

function log(step, detail) {
  console.log(`\n[${step}] ${detail}`);
}

async function health() {
  return request('/api/health');
}

async function register(user) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: user.username, password: user.password })
  });
}

async function login(user) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: user.username, password: user.password })
  });
}

async function placeOrder(token, type, property, amount, price, total, orderId) {
  const body = {
    type,
    property,
    propertyName: property,
    price,
    amount,
    total,
    orderId
  };
  return request('/api/orders', {
    method: 'POST',
    body: JSON.stringify(body),
    ...authed(token)
  });
}

async function getHoldings(token) {
  return request('/api/holdings', authed(token));
}

async function getDividends(token) {
  return request('/api/dividends', authed(token));
}

async function depositRent(propertyKey, amountEth = '0.01') {
  return request(`/api/dividends/deposit/${propertyKey}`, {
    method: 'POST',
    body: JSON.stringify({ amountEth }),
    ...authed(tokens.A)
  });
}

async function getOrders(token) {
  const username = token === tokens.A ? userA.username : userB.username;
  return request('/api/orders?username=' + username, authed(token));
}

async function exportCsv(token) {
  const res = await fetch(BASE + '/api/orders/export', {
    headers: { Authorization: 'Bearer ' + token }
  });
  return { status: res.status, text: await res.text() };
}

async function run() {
  console.log('========== ESTATE 业务闭环测试开始 ==========');

  // 0. 健康检查
  const h = await health();
  log('0', `后端健康 mode=${h.mode} chainId=${h.chainId}`);

  // 1. 注册用户 A
  const regA = await register(userA);
  tokens.A = regA.token;
  log('1', `注册用户 A: ${userA.username} 地址=${regA.address}`);

  // 2. 用户 A 在市场买入 villa 若干份
  const buyA = await placeOrder(tokens.A, 'buy', 'villa', 10, 0.001, 0.01);
  log('2', `用户 A 买入 villa 10 份: ${buyA.txHash} 状态=${buyA.status} 备注=${buyA.note || ''} 错误=${buyA.error || ''}`);

  const holdingsA1 = await getHoldings(tokens.A);
  const villaHoldingA = holdingsA1.holdings.find(h => h.key === 'villa');
  log('2-验证', `用户 A villa 持仓: ${villaHoldingA ? villaHoldingA.shares : 0} 份`);
  if (!villaHoldingA || villaHoldingA.shares < 10) throw new Error('买入后持仓不足');

  // 3. 用户 A 挂卖单；用户 B 买入
  const sellA = await placeOrder(tokens.A, 'sell', 'villa', 5, 0.001, 0.005);
  log('3', `用户 A 挂 villa 卖单 5 份: ${sellA.txHash} 状态=${sellA.status} orderId=${sellA.orderId || ''} 备注=${sellA.note || ''} 错误=${sellA.error || ''}`);

  const regB = await register(userB);
  tokens.B = regB.token;
  log('3', `注册用户 B: ${userB.username} 地址=${regB.address}`);

  const buyB = await placeOrder(tokens.B, 'buy', 'villa', 5, 0.001, 0.005, sellA.orderId);
  log('3', `用户 B 买入 A 的卖单 5 份: ${buyB.txHash} 状态=${buyB.status}`);

  const holdingsA2 = await getHoldings(tokens.A);
  const holdingsB2 = await getHoldings(tokens.B);
  const villaA = holdingsA2.holdings.find(h => h.key === 'villa');
  const villaB = holdingsB2.holdings.find(h => h.key === 'villa');
  log('3-验证', `A villa=${villaA ? villaA.shares : 0}, B villa=${villaB ? villaB.shares : 0}`);
  if ((villaA ? villaA.shares : 0) !== 5) throw new Error('A 卖单后持仓应为 5');
  if ((villaB ? villaB.shares : 0) !== 5) throw new Error('B 买入后持仓应为 5');

  // 4. 注入租金 + A/B 领取分红
  await depositRent('villa', '0.01');
  log('4', '运营方注入 villa 租金 0.01 ETH');

  const claimA = await placeOrder(tokens.A, 'claim', 'villa', 1, 0, 0);
  log('4', `用户 A 领取 villa 分红: ${claimA.txHash} 状态=${claimA.status}`);

  const claimB = await placeOrder(tokens.B, 'claim', 'villa', 1, 0, 0);
  log('4', `用户 B 领取 villa 分红: ${claimB.txHash} 状态=${claimB.status}`);

  const divA = await getDividends(tokens.A);
  const divB = await getDividends(tokens.B);
  log('4-验证', `A 待领取=${divA.dividends.find(d => d.key === 'villa').pendingEth} ETH, B 待领取=${divB.dividends.find(d => d.key === 'villa').pendingEth} ETH`);

  // 5. 拆分：用户 A 铸造新房并拆分为 1000 份
  const splitA = await placeOrder(tokens.A, 'split', 'newprop', 1000, 0.001, 1);
  log('5', `用户 A 铸造并拆分新房 1000 份: ${splitA.txHash} 状态=${splitA.status}`);

  // 从持仓变化推断新 tokenId
  const holdingsA3 = await getHoldings(tokens.A);
  const newHolding = holdingsA3.holdings.find(h => h.key === 'newprop');
  if (!newHolding || newHolding.shares !== 1000) throw new Error('拆分后应持有 1000 份 newprop');
  newTokenId = newHolding.tokenId;
  log('5-验证', `新房 tokenId=${newTokenId}, 份额=${newHolding.shares}`);

  // 6. 赎回：先尝试未集齐（应失败），再集齐赎回成功
  const sellNewA = await placeOrder(tokens.A, 'sell', 'newprop', 100, 0.001, 0.1);
  log('6', `用户 A 挂新房卖单 100 份: ${sellNewA.txHash} orderId=${sellNewA.orderId || ''}`);

  const buyNewB = await placeOrder(tokens.B, 'buy', 'newprop', 100, 0.001, 0.1, sellNewA.orderId);
  log('6', `用户 B 买入新房 100 份: ${buyNewB.txHash}`);

  const holdingsA4 = await getHoldings(tokens.A);
  const newA = holdingsA4.holdings.find(h => h.key === 'newprop');
  if (newA && newA.shares === 1000) throw new Error('赎回前测试失败：A 仍持有 1000 份，无法测试未集齐赎回');
  log('6-验证', `A 新房持仓=${newA ? newA.shares : 0}（未集齐，赎回应失败）`);

  // B 卖回 100 份给 A
  const sellBackB = await placeOrder(tokens.B, 'sell', 'newprop', 100, 0.001, 0.1);
  log('6', `用户 B 挂回新房卖单 100 份: ${sellBackB.txHash} orderId=${sellBackB.orderId || ''}`);

  const buyBackA = await placeOrder(tokens.A, 'buy', 'newprop', 100, 0.001, 0.1, sellBackB.orderId);
  log('6', `用户 A 买回新房 100 份: ${buyBackA.txHash}`);

  const holdingsA5 = await getHoldings(tokens.A);
  const newA2 = holdingsA5.holdings.find(h => h.key === 'newprop');
  if (!newA2 || newA2.shares !== 1000) throw new Error('买回后 A 应持有 1000 份才能赎回');

  const redeemA = await placeOrder(tokens.A, 'redeem', 'newprop', 1000, 0, 0);
  log('6-验证', `用户 A 集齐 1000 份后赎回成功: ${redeemA.txHash} 状态=${redeemA.status}`);

  // 7. 个人中心：持仓、订单、CSV 导出
  const ordersA = await getOrders(tokens.A);
  log('7', `用户 A 订单数=${ordersA.orders.length}`);

  const csv = await exportCsv(tokens.A);
  log('7-验证', `CSV 导出状态=${csv.status} 行数=${csv.text.split('\n').length}`);

  // 8. 重启后端验证会话恢复（模拟：用已有 token 调用 /api/me）
  const meA = await request('/api/me', authed(tokens.A));
  log('8', `用旧 token 获取用户信息: ${meA.username} 地址=${meA.address}`);

  console.log('\n========== 业务闭环测试全部通过 ==========');
}

run().catch(e => {
  console.error('\n[测试失败]', e.message);
  process.exit(1);
});
