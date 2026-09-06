/*
 * 本地区块链一键部署（全套 RWA）+ 种子数据
 * 用法：
 *   终端1: npx hardhat node
 *   终端2: npx hardhat run scripts/deploy-local.js --network localhost
 * 完成后写入 ../backend/.env 与 ../realestate-nft-fraction/assets/contracts.json
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { deployFull } = require('./_deploy-core');

const PROPERTIES = [
  { key: 'villa',     name: '虹桥轻奢别墅',     shares: 1000, priceEth: '0.001',  priceUsd: 3,   uri: 'ipfs://estate/villa.json' },
  { key: 'loft',      name: '静安 Loft 公寓',   shares: 1000, priceEth: '0.0005', priceUsd: 1.5, uri: 'ipfs://estate/loft.json' },
  { key: 'office',    name: '陆家嘴甲级写字楼', shares: 1000, priceEth: '0.0012', priceUsd: 3.6, uri: 'ipfs://estate/office.json' },
  { key: 'apartment', name: '徐汇精装公寓',     shares: 1000, priceEth: '0.0006', priceUsd: 1.8, uri: 'ipfs://estate/apartment.json' }
];

async function main() {
  const r = await deployFull({
    seed: true,
    properties: PROPERTIES,
    votingDelay: 0,
    votingPeriod: 300,   // 5 分钟投票期
    timelockDelay: 60,   // 1 分钟时间锁
    proposalThreshold: 10,
    quorumPercent: 10
  });
  const c = r.contracts;

  const config = {
    network: 'localhost',
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    deployer: r.deployer,
    contracts: c,
    properties: r.properties,
    deployedAt: new Date().toISOString()
  };

  // 写入后端 .env
  const backendDir = path.join(__dirname, '..', '..', 'backend');
  if (fs.existsSync(backendDir)) {
    const envPath = path.join(backendDir, '.env');
    const env = [
      'PORT=3001',
      'RPC_URL=http://127.0.0.1:8545',
      'CHAIN_ID=31337',
      'CONTRACT_ESTATE_NFT=' + c.estateNFT,
      'CONTRACT_FRACTION_TOKEN=' + c.fractionToken,
      'CONTRACT_MARKET=' + c.market,
      'CONTRACT_PRICE_ORACLE=' + c.priceOracle,
      'CONTRACT_USDC=' + c.usdc,
      'CONTRACT_GOVERNOR=' + c.governor,
      'PRICE_FEED=' + c.priceFeed,
      'DEPLOYER_ADDRESS=' + r.deployer,
      '# Hardhat 本地测试账户 #0 私钥（仅本地演示用）',
      'ADMIN_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      'FAUCET_ETH=1',
      ''
    ].join('\n');
    fs.writeFileSync(envPath, env, 'utf8');
    console.log('已写入 backend/.env');
  }

  // 写入前端 contracts.json
  const fePath = path.join(__dirname, '..', '..', 'realestate-nft-fraction', 'assets', 'contracts.json');
  fs.mkdirSync(path.dirname(fePath), { recursive: true });
  fs.writeFileSync(fePath, JSON.stringify(config, null, 2), 'utf8');
  console.log('已写入 realestate-nft-fraction/assets/contracts.json');

  console.log('\n=== 部署完成（本地全套 RWA）===');
  console.log('EstateNFT:     ', c.estateNFT);
  console.log('FractionToken: ', c.fractionToken);
  console.log('EstateMarket:  ', c.market);
  console.log('PriceFeed:     ', c.priceFeed);
  console.log('RwaPriceOracle:', c.priceOracle);
  console.log('MockUSDC:      ', c.usdc);
  console.log('EstateGovernor:', c.governor);
}

main().catch((e) => { console.error(e); process.exit(1); });
