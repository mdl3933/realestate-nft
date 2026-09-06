/*
 * 本地区块链一键部署 + 种子数据
 * 用法：
 *   终端1: npx hardhat node
 *   终端2: npx hardhat run scripts/deploy-local.js --network localhost
 * 完成后会把合约地址写入 ../backend/.env 与 ../realestate-nft-fraction/assets/contracts.json
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

// 前端房产 key -> 元数据
const PROPERTIES = [
  { key: 'villa',     name: '虹桥轻奢别墅',     shares: 1000, priceEth: '0.001', uri: 'ipfs://estate/villa.json' },
  { key: 'loft',      name: '静安 Loft 公寓',   shares: 1000, priceEth: '0.0005', uri: 'ipfs://estate/loft.json' },
  { key: 'office',    name: '陆家嘴甲级写字楼', shares: 1000, priceEth: '0.0012', uri: 'ipfs://estate/office.json' },
  { key: 'apartment', name: '徐汇精装公寓',     shares: 1000, priceEth: '0.0006', uri: 'ipfs://estate/apartment.json' }
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('部署账户:', deployer.address);
  console.log('账户余额:', hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), 'ETH');

  // 1. 部署合约
  const EstateNFT = await hre.ethers.getContractFactory('EstateNFT');
  const estateNFT = await EstateNFT.deploy();
  await estateNFT.waitForDeployment();
  const nftAddr = await estateNFT.getAddress();

  const FractionToken = await hre.ethers.getContractFactory('FractionToken');
  const fractionToken = await FractionToken.deploy('https://estatenft.example/api/metadata/{id}.json');
  await fractionToken.waitForDeployment();
  const ftAddr = await fractionToken.getAddress();

  const EstateMarket = await hre.ethers.getContractFactory('EstateMarket');
  const market = await EstateMarket.deploy(nftAddr, ftAddr);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();

  await (await estateNFT.setMarket(marketAddr)).wait();
  await (await fractionToken.setMarket(marketAddr)).wait();
  console.log('合约部署完成，Market 权限已设置');

  // 2. 授权 Market 操作 deployer 的 ERC721 / ERC1155
  await (await estateNFT.setApprovalForAll(marketAddr, true)).wait();
  await (await fractionToken.setApprovalForAll(marketAddr, true)).wait();

  // 3. 铸造房产 -> 拆分 -> 挂卖单
  const seed = [];
  for (let i = 0; i < PROPERTIES.length; i++) {
    const p = PROPERTIES[i];
    const tokenId = await estateNFT.mintProperty.staticCall(deployer.address, p.uri);
    await (await estateNFT.mintProperty(deployer.address, p.uri)).wait();
    await (await market.fractionalize(tokenId, p.shares)).wait();
    const priceWei = hre.ethers.parseEther(p.priceEth);
    const orderId = await market.createSellOrder.staticCall(tokenId, p.shares, priceWei);
    await (await market.createSellOrder(tokenId, p.shares, priceWei)).wait();
    console.log(`  [${p.key}] tokenId=${tokenId} 拆分=${p.shares}份 卖单#${orderId} 单价=${p.priceEth}ETH`);
    seed.push({ key: p.key, name: p.name, tokenId: Number(tokenId), orderId: Number(orderId), shares: p.shares, priceEth: p.priceEth, priceWei: priceWei.toString() });
  }

  const config = {
    network: 'localhost',
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    deployer: deployer.address,
    contracts: { estateNFT: nftAddr, fractionToken: ftAddr, market: marketAddr },
    properties: seed,
    deployedAt: new Date().toISOString()
  };

  // 4. 写入后端 .env
  const backendDir = path.join(__dirname, '..', '..', 'backend');
  if (fs.existsSync(backendDir)) {
    const envPath = path.join(backendDir, '.env');
    const env = [
      'PORT=3001',
      'RPC_URL=http://127.0.0.1:8545',
      'CHAIN_ID=31337',
      `CONTRACT_ESTATE_NFT=${nftAddr}`,
      `CONTRACT_FRACTION_TOKEN=${ftAddr}`,
      `CONTRACT_MARKET=${marketAddr}`,
      `DEPLOYER_ADDRESS=${deployer.address}`,
      '# Hardhat 本地测试账户 #0 私钥（仅本地演示用）',
      'ADMIN_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      'FAUCET_ETH=1',
      ''
    ].join('\n');
    fs.writeFileSync(envPath, env, 'utf8');
    console.log('已写入 backend/.env');
  }

  // 5. 写入前端 contracts.json
  const fePath = path.join(__dirname, '..', '..', 'realestate-nft-fraction', 'assets', 'contracts.json');
  fs.writeFileSync(fePath, JSON.stringify(config, null, 2), 'utf8');
  console.log('已写入 realestate-nft-fraction/assets/contracts.json');

  console.log('\n=== 部署完成 ===');
  console.log('EstateNFT:    ', nftAddr);
  console.log('FractionToken:', ftAddr);
  console.log('EstateMarket: ', marketAddr);
}

main().catch((e) => { console.error(e); process.exit(1); });
