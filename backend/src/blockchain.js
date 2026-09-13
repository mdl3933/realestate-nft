/*
 * 区块链交互层（ethers v6）
 * - 后端托管用户钱包（keystore 加密），无需 MetaMask
 * - 通过 Hardhat 本地节点(http://127.0.0.1:8545) 读写 EstateNFT / FractionToken / EstateMarket
 */
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const ADMIN_KEY = process.env.ADMIN_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const FAUCET_ETH = process.env.FAUCET_ETH || '1';

const ABI = {
  nft: [
    'function mintProperty(address to, string tokenURI) returns (uint256)',
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'function isFractionalized(uint256 tokenId) view returns (bool)',
    'function ownerOf(uint256 tokenId) view returns (address)'
  ],
  ft: [
    'function balanceOf(address account, uint256 id) view returns (uint256)',
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)'
  ],
  market: [
    'function fractionalize(uint256 tokenId, uint256 totalShares)',
    'function createSellOrder(uint256 tokenId, uint256 amount, uint256 pricePerShare) returns (uint256)',
    'function buyShares(uint256 orderId, uint256 amount) payable',
    'function depositRent(uint256 tokenId) payable',
    'function claimDividend(uint256 tokenId)',
    'function redeem(uint256 tokenId)',
    'function getSellOrder(uint256 orderId) view returns (address seller, uint256 tokenId, uint256 amount, uint256 pricePerShare, bool active)',
    'function getSellOrderCount() view returns (uint256)',
    'function getPendingDividend(address user, uint256 tokenId) view returns (uint256)'
    'function totalFractions(uint256 tokenId) view returns (uint256)'
  ]
};

let provider = null;
let admin = null;
let nft = null;
let ft = null;
let market = null;
let config = null;

function loadConfig() {
  const p = path.join(__dirname, '..', '..', 'realestate-nft-fraction', 'assets', 'contracts.json');
  try {
    config = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    config = { contracts: { estateNFT: process.env.CONTRACT_ESTATE_NFT, fractionToken: process.env.CONTRACT_FRACTION_TOKEN, market: process.env.CONTRACT_MARKET }, properties: [] };
  }
  return config;
}

async function init() {
  loadConfig();
  provider = new ethers.JsonRpcProvider(RPC_URL);
  await provider.getBlockNumber().catch(() => { throw new Error('无法连接区块链节点 ' + RPC_URL + '，请先运行 npx hardhat node 并部署合约'); });
  admin = new ethers.Wallet(ADMIN_KEY, provider);
  const c = config.contracts;
  nft = new ethers.Contract(c.estateNFT, ABI.nft, provider);
  ft = new ethers.Contract(c.fractionToken, ABI.ft, provider);
  market = new ethers.Contract(c.market, ABI.market, provider);
  return { chainId: (await provider.getNetwork()).chainId.toString(), admin: admin.address, contracts: c };
}

function propMeta(propertyKey) {
  const byKey = (config.properties || []).find((p) => p.key === propertyKey);
  if (byKey) return _ensureWei(byKey);
  const idx = ['villa', 'loft', 'office', 'apartment'].indexOf(propertyKey);
  if (idx >= 0 && config.properties[idx]) return _ensureWei(config.properties[idx]);
  return _ensureWei(config.properties[0] || { tokenId: 0, orderId: 0, priceEth: '0.001' });
}
function _ensureWei(p) {
  if (!p.priceWei && p.priceEth) {
    p.priceWei = ethers.parseEther(p.priceEth).toString();
  }
  return p;
}

async function chainInfo() {
  if (!provider) return { ok: false };
  try {
    const block = await provider.getBlockNumber();
    return { ok: true, chainId: (await provider.getNetwork()).chainId.toString(), block, admin: admin.address, contracts: config.contracts };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 托管钱包：创建随机钱包（调用方用用户密码加密保存）
async function createWallet() {
  return ethers.Wallet.createRandom();
}
// 用用户密码把钱包序列化为加密 keystore（JSON 字符串）
async function encryptWallet(wallet, password) {
  return wallet.encrypt(password);
}
// 用密码解锁 keystore，返回连接到节点的签名者（密码错误会抛异常）
async function unlockSigner(keystoreJson, password) {
  const w = await ethers.Wallet.fromEncryptedJson(keystoreJson, password);
  return w.connect(provider);
}
// 由私钥直接构建签名者（用于后端重启后恢复持久化会话，无需用户再次输入密码）
function signerFromKey(privateKey) {
  return new ethers.Wallet(privateKey, provider);
}

async function balance(addr) {
  return ethers.formatEther(await provider.getBalance(addr));
}

async function ensureFunds(addr) {
  const bal = await provider.getBalance(addr);
  if (bal < ethers.parseEther('0.02')) {
    const tx = await admin.sendTransaction({ to: addr, value: ethers.parseEther(FAUCET_ETH) });
    await tx.wait();
    return true;
  }
  return false;
}

async function holdings(addr) {
  const out = [];
  for (const p of config.properties || []) {
    const bal = await ft.balanceOf(addr, p.tokenId);
    out.push({ key: p.key, name: p.name, tokenId: p.tokenId, shares: Number(bal), priceEth: p.priceEth });
  }
  return out;
}

// 查询所有房产的待领取分红（wei），同时返回持仓份额
async function dividends(addr) {
  const out = [];
  for (const p of config.properties || []) {
    const bal = await ft.balanceOf(addr, p.tokenId);
    const pending = await market.getPendingDividend(addr, p.tokenId).catch(() => 0n);
    out.push({
      key: p.key,
      name: p.name,
      tokenId: p.tokenId,
      shares: Number(bal),
      priceEth: p.priceEth,
      pendingWei: pending.toString(),
      pendingEth: ethers.formatEther(pending),
      totalShares: Number(await market.totalFractions(p.tokenId).catch(() => 0n))
    });
  }
  return out;
}

// 执行订单（返回 txHash）
async function executeOrder(order, signer) {
  const meta = propMeta(order.property);
  const amount = Math.max(1, Number(order.amount || 1));
  const userAddr = signer.address;
  await ensureFunds(userAddr);

  if (order.type === 'buy') {
    const value = BigInt(meta.priceWei) * BigInt(amount);
    const tx = await market.connect(signer).buyShares(meta.orderId, amount, { value });
    const r = await tx.wait();
    return { txHash: r.transactionHash, note: '链上买入 ' + amount + ' 份 ' + meta.name };
  }

  if (order.type === 'sell') {
    const approved = await ft.isApprovedForAll(userAddr, await market.getAddress());
    if (!approved) await (await ft.connect(signer).setApprovalForAll(await market.getAddress(), true)).wait();
    const tx = await market.connect(signer).createSellOrder(meta.tokenId, amount, BigInt(meta.priceWei));
    const r = await tx.wait();
    return { txHash: r.transactionHash, note: '链上挂卖单 ' + amount + ' 份 ' + meta.name };
  }

  if (order.type === 'split') {
    const uri = 'ipfs://estate/' + (meta.key || order.property) + '.json';
    const tokenId = await nft.connect(signer).mintProperty.staticCall(userAddr, uri);
    await (await nft.connect(signer).mintProperty(userAddr, uri)).wait();
    const approved = await nft.isApprovedForAll(userAddr, await market.getAddress());
    if (!approved) await (await nft.connect(signer).setApprovalForAll(await market.getAddress(), true)).wait();
    const tx = await market.connect(signer).fractionalize(tokenId, amount);
    const r = await tx.wait();
    return { txHash: r.transactionHash, note: '链上铸造并拆分 ' + amount + ' 份（tokenId ' + tokenId + '）' };
  }

  if (order.type === 'claim') {
    // 运营方先注入租金，再由用户领取
    await (await market.connect(admin).depositRent(meta.tokenId, { value: ethers.parseEther('0.01') })).wait();
    const pending = await market.getPendingDividend(userAddr, meta.tokenId);
    if (pending === 0n) throw new Error('该房产暂无可领取分红（需先持有份额）');
    const tx = await market.connect(signer).claimDividend(meta.tokenId);
    const r = await tx.wait();
    return { txHash: r.transactionHash, note: '链上领取 ' + meta.name + ' 租金分红' };
  }

  if (order.type === 'redeem') {
    const tx = await market.connect(signer).redeem(meta.tokenId);
    const r = await tx.wait();
    return { txHash: r.transactionHash, note: '链上赎回合并 ' + meta.name };
  }

  throw new Error('未知订单类型: ' + order.type);
}

// 运营方注入租金（用于演示分红）
async function depositRent(propertyKey, amountEth) {
  const meta = propMeta(propertyKey);
  const amount = ethers.parseEther(amountEth || '0.01');
  const tx = await market.connect(admin).depositRent(meta.tokenId, { value: amount });
  const r = await tx.wait();
  return { txHash: r.transactionHash, note: '链上注入租金 ' + amountEth + ' ETH（' + meta.name + '）' };
}

module.exports = { init, chainInfo, createWallet, encryptWallet, unlockSigner, signerFromKey, balance, holdings, dividends, executeOrder, depositRent, ethers };
