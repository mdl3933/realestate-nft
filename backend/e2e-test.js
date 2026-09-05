// 端到端流程测试：注册 → 铸造 → 碎片化 → 挂单 → 购买 → 分红
const BASE = 'http://127.0.0.1:3001/api';

async function call(method, endpoint, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${endpoint} -> ${res.status}: ${data.error || JSON.stringify(data)}`);
  return data;
}

function log(step, msg) {
  console.log(`\n[${step}] ${msg}`);
}

async function main() {
  log('1/9', '注册用户 alice（房产发行方）...');
  const alice = await call('POST', '/auth/register', { username: 'alice', password: '123456' });
  console.log('  钱包地址:', alice.user.walletAddress);
  const aliceToken = alice.token;

  log('2/9', '注册用户 bob（投资者）...');
  const bob = await call('POST', '/auth/register', { username: 'bob', password: '123456' });
  console.log('  钱包地址:', bob.user.walletAddress);
  const bobToken = bob.token;

  log('3/9', 'Alice 铸造房产 NFT...');
  const mint = await call('POST', '/properties/mint', {
    name: '上海陆家嘴中心写字楼',
    location: '上海市浦东新区陆家嘴环路 1000 号',
    description: '甲级写字楼，年租金回报约 6%',
    imageUri: '',
  }, aliceToken);
  const tokenId = mint.property.token_id;
  console.log('  TokenId:', tokenId, '| TxHash:', mint.property.tx_hash.slice(0, 18) + '...');

  log('4/9', 'Alice 将房产碎片化为 1000 份...');
  const frac = await call('POST', '/properties/fractionalize', { tokenId, totalShares: 1000 }, aliceToken);
  console.log('  碎片化完成，总份数:', frac.property.total_shares);

  log('5/9', '查询 Alice 持有的份额...');
  const bal = await call('GET', `/balance/${tokenId}`, null, aliceToken);
  console.log('  Alice 持有份额:', bal.amount);

  log('6/9', 'Alice 挂卖单：100 份 × 0.001 ETH...');
  const priceWei = BigInt(Math.floor(0.001 * 1e18)).toString();
  const order = await call('POST', '/orders', { tokenId, amount: 100, pricePerShareWei: priceWei }, aliceToken);
  console.log('  订单 ID:', order.order.orderId, '| TxHash:', order.order.tx_hash.slice(0, 18) + '...');

  log('7/9', 'Bob 购买 50 份...');
  const buy = await call('POST', `/orders/${order.order.orderId}/buy`, { amount: 50 }, bobToken);
  console.log('  购买成功，支付总价(wei):', buy.totalPriceWei);

  log('8/9', '查询 Bob 持有的份额...');
  const bobBal = await call('GET', `/balance/${tokenId}`, null, bobToken);
  console.log('  Bob 持有份额:', bobBal.amount);

  log('9/9', '管理员存入 1 ETH 租金分红...');
  const rentWei = BigInt(Math.floor(1 * 1e18)).toString();
  const deposit = await call('POST', '/admin/deposit-rent', { tokenId, amountWei: rentWei }, aliceToken);
  console.log('  租金存入成功，TxHash:', deposit.txHash.slice(0, 18) + '...');

  const pending = await call('GET', `/dividends/pending/${tokenId}`, null, bobToken);
  console.log('  Bob 待领取分红(wei):', pending.amount);

  const props = await call('GET', '/properties', null, aliceToken);
  console.log('\n=== 房产列表 ===');
  props.properties.forEach(p => {
    console.log(`  TokenId ${p.token_id}: ${p.name} | 碎片化: ${p.isFractionalized} | 总份数: ${p.totalShares}`);
  });

  const orders = await call('GET', '/orders', null, aliceToken);
  console.log('\n=== 卖单列表 ===');
  orders.orders.forEach(o => {
    console.log(`  订单 ${o.orderId}: TokenId ${o.tokenId} | 剩余 ${o.amount} 份 | 卖家 ${o.sellerUsername} | 活跃: ${o.active}`);
  });

  console.log('\n=== 端到端流程全部通过 ===');
}

main().catch((err) => {
  console.error('\n测试失败:', err.message);
  process.exit(1);
});
