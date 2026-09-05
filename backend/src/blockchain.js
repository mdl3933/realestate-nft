const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');
const { decryptPrivateKey } = require('./crypto');

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const CHAIN_ID = Number(process.env.CHAIN_ID || '31337');
const ESTATE_NFT_ADDRESS = process.env.CONTRACT_ESTATE_NFT;
const FRACTION_TOKEN_ADDRESS = process.env.CONTRACT_FRACTION_TOKEN;
const MARKET_ADDRESS = process.env.CONTRACT_MARKET;
let deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

// Local Hardhat account #0 fallback for demo
const HARDHAT_ACCOUNT_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function normalizeKey(key) {
  if (!key) return null;
  key = key.trim();
  return key.startsWith('0x') ? key : `0x${key}`;
}

function loadAbi(contractName) {
  const artifactPath = path.join(
    __dirname,
    '../../realestate-nft-contracts/artifacts/contracts',
    `${contractName}.sol`,
    `${contractName}.json`
  );
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Contract artifact not found: ${artifactPath}. Did you run \"npm run compile\" in realestate-nft-contracts?`);
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  return artifact.abi;
}

const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID);

let estateNFT;
let fractionToken;
let market;
let adminWallet;
let adminAddress;

// 缓存每个用户的 NonceManager 钱包，避免跨请求 nonce 重复
const walletCache = new Map();

function initContracts() {
  if (!ESTATE_NFT_ADDRESS || !FRACTION_TOKEN_ADDRESS || !MARKET_ADDRESS) {
    throw new Error(
      'CONTRACT_ESTATE_NFT, CONTRACT_FRACTION_TOKEN and CONTRACT_MARKET must be set in backend/.env'
    );
  }

  estateNFT = new ethers.Contract(ESTATE_NFT_ADDRESS, loadAbi('EstateNFT'), provider);
  fractionToken = new ethers.Contract(FRACTION_TOKEN_ADDRESS, loadAbi('FractionToken'), provider);
  market = new ethers.Contract(MARKET_ADDRESS, loadAbi('EstateMarket'), provider);

  deployerKey = normalizeKey(deployerKey) || normalizeKey(HARDHAT_ACCOUNT_0);
  // 用 NonceManager 包装管理员钱包，自动管理 nonce
  const adminRaw = new ethers.Wallet(deployerKey, provider);
  adminAddress = adminRaw.address;
  adminWallet = new ethers.NonceManager(adminRaw);
}

function getUserWallet(userFull) {
  const address = userFull.wallet_address.toLowerCase();
  if (walletCache.has(address)) {
    return walletCache.get(address);
  }
  const privateKey = decryptPrivateKey(userFull.encrypted_private_key);
  const wallet = new ethers.Wallet(normalizeKey(privateKey), provider);
  // 用 NonceManager 包装，在内存中跟踪 nonce，防止交易计数竞争
  const managed = new ethers.NonceManager(wallet);
  walletCache.set(address, managed);
  return managed;
}

function waitForTx(txResponse) {
  return txResponse.wait();
}

async function ensureERC721Approval(userWallet) {
  const userAddress = userWallet.address;
  const isApproved = await estateNFT.isApprovedForAll(userAddress, MARKET_ADDRESS);
  if (!isApproved) {
    const tx = await estateNFT.connect(userWallet).setApprovalForAll(MARKET_ADDRESS, true);
    await waitForTx(tx);
  }
}

async function ensureERC1155Approval(userWallet) {
  const userAddress = userWallet.address;
  const isApproved = await fractionToken.isApprovedForAll(userAddress, MARKET_ADDRESS);
  if (!isApproved) {
    const tx = await fractionToken.connect(userWallet).setApprovalForAll(MARKET_ADDRESS, true);
    await waitForTx(tx);
  }
}

async function fundAddress(address, amountEth) {
  const tx = await adminWallet.sendTransaction({
    to: address,
    value: ethers.parseEther(String(amountEth)),
  });
  const receipt = await waitForTx(tx);
  return { txHash: receipt.hash, amountEth, to: address };
}

function buildTokenURI({ name, location, description, imageUri }) {
  const metadata = {
    name,
    description: description || `${location} 的碎片化房产权益`,
    image: imageUri || '',
    attributes: [
      { trait_type: 'Location', value: location },
      { trait_type: 'Type', value: 'Fractional Real Estate' },
    ],
  };
  const json = Buffer.from(JSON.stringify(metadata)).toString('base64');
  return `data:application/json;base64,${json}`;
}

async function mintProperty(userFull, { name, location, description, imageUri }) {
  const userWallet = getUserWallet(userFull);
  const tokenURI = buildTokenURI({ name, location, description, imageUri });

  const tx = await estateNFT.connect(userWallet).mintProperty(userWallet.address, tokenURI);
  const receipt = await waitForTx(tx);

  const totalSupply = await estateNFT.totalSupply();
  const tokenId = Number(totalSupply) - 1;

  return { tokenId, tokenURI, txHash: receipt.hash };
}

async function fractionalize(userFull, tokenId, totalShares) {
  const userWallet = getUserWallet(userFull);
  await ensureERC721Approval(userWallet);

  const tx = await market.connect(userWallet).fractionalize(tokenId, totalShares);
  const receipt = await waitForTx(tx);

  return { txHash: receipt.hash };
}

async function createSellOrder(userFull, tokenId, amount, pricePerShareWei) {
  const userWallet = getUserWallet(userFull);
  await ensureERC1155Approval(userWallet);

  const tx = await market.connect(userWallet).createSellOrder(tokenId, amount, pricePerShareWei);
  const receipt = await waitForTx(tx);

  const count = await market.getSellOrderCount();
  const orderId = Number(count) - 1;

  return { orderId, txHash: receipt.hash };
}

async function buyShares(userFull, orderId, amount) {
  const userWallet = getUserWallet(userFull);
  const order = await market.getSellOrder(orderId);
  const totalPriceWei = BigInt(order.pricePerShare) * BigInt(amount);

  const tx = await market.connect(userWallet).buyShares(orderId, amount, { value: totalPriceWei });
  const receipt = await waitForTx(tx);

  return { txHash: receipt.hash, totalPriceWei: totalPriceWei.toString() };
}

async function claimDividend(userFull, tokenId) {
  const userWallet = getUserWallet(userFull);
  const tx = await market.connect(userWallet).claimDividend(tokenId);
  const receipt = await waitForTx(tx);
  return { txHash: receipt.hash };
}

async function redeem(userFull, tokenId) {
  const userWallet = getUserWallet(userFull);
  const tx = await market.connect(userWallet).redeem(tokenId);
  const receipt = await waitForTx(tx);
  return { txHash: receipt.hash };
}

async function depositRent(_userFull, tokenId, amountWei) {
  const tx = await market.connect(adminWallet).depositRent(tokenId, { value: amountWei });
  const receipt = await waitForTx(tx);
  return { txHash: receipt.hash, amountWei: amountWei.toString() };
}

async function getBalance(address, tokenId) {
  const balance = await fractionToken.balanceOf(address, tokenId);
  return balance.toString();
}

async function getPendingDividend(address, tokenId) {
  const amount = await market.getPendingDividend(address, tokenId);
  return amount.toString();
}

async function getSellOrders() {
  const count = Number(await market.getSellOrderCount());
  const orders = [];
  for (let i = 0; i < count; i++) {
    const o = await market.getSellOrder(i);
    orders.push({
      orderId: String(i),
      seller: o.seller,
      tokenId: Number(o.tokenId),
      amount: Number(o.amount),
      pricePerShareWei: o.pricePerShare.toString(),
      active: o.active,
    });
  }
  return orders;
}

async function getProperties(dbProperties) {
  return Promise.all(
    dbProperties.map(async (p) => {
      let isFractionalized = p.is_fractionalized;
      let totalShares = p.total_shares;
      try {
        isFractionalized = await estateNFT.isFractionalized(p.token_id);
        totalShares = isFractionalized ? Number(await market.totalFractions(p.token_id)) : 0;
      } catch (e) {
        // keep DB values if chain call fails
      }
      return {
        ...p,
        is_fractionalized: isFractionalized,
        isFractionalized,
        total_shares: totalShares,
        totalShares,
      };
    })
  );
}

function getAdminAddress() {
  return adminAddress || null;
}

module.exports = {
  initContracts,
  fundAddress,
  mintProperty,
  fractionalize,
  createSellOrder,
  buyShares,
  claimDividend,
  redeem,
  depositRent,
  getBalance,
  getPendingDividend,
  getSellOrders,
  getProperties,
  getAdminAddress,
};
