/*
 * Polygon Amoy 测试网部署（全套 RWA）
 * 用法：
 *   在 .env 中配置 PRIVATE_KEY / POLYGON_AMOY_RPC_URL / POLYGONSCAN_API_KEY / ETH_USD_FEED(可选)
 *   npx hardhat run scripts/deploy.js --network amoy
 * 若未提供 ETH_USD_FEED，将部署 MockV3Aggregator（仅演示，生产应使用 Chainlink 真实喂价）。
 */
const hre = require('hardhat');
const fs = require('fs');
const path = require('path');
const { deployFull } = require('./_deploy-core');

async function tryVerify(address, args = []) {
  if (!process.env.POLYGONSCAN_API_KEY) {
    console.log('未设置 POLYGONSCAN_API_KEY，跳过 polygonscan 验证');
    return;
  }
  try {
    await hre.run('verify:verify', { address, constructorArguments: args });
    console.log('已验证:', address);
  } catch (e) {
    console.log('验证跳过/失败（可能已验证）:', e.message || e);
  }
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const bal = hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address));
  console.log('网络:', hre.network.name, ' 账户:', deployer.address, ' 余额:', bal, 'POL');

  const r = await deployFull({
    seed: false,
    ethUsdFeed: process.env.ETH_USD_FEED || null,
    votingDelay: 1,
    votingPeriod: 1800,   // 30 分钟投票期（便于评委现场观察）
    timelockDelay: 600,   // 10 分钟时间锁
    proposalThreshold: 10,
    quorumPercent: 10
  });
  const c = r.contracts;

  // 记录部署地址
  const depDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(depDir, { recursive: true });
  const out = {
    network: hre.network.name,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    deployer: r.deployer,
    contracts: c,
    deployedAt: new Date().toISOString()
  };
  fs.writeFileSync(path.join(depDir, hre.network.name + '.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('部署地址已写入 deployments/' + hre.network.name + '.json');

  // polygonscan 验证
  await tryVerify(c.estateNFT, []);
  await tryVerify(c.fractionToken, ['https://estatenft.example/api/metadata/{id}.json']);
  await tryVerify(c.market, [c.estateNFT, c.fractionToken]);
  await tryVerify(c.priceOracle, [c.priceFeed]);
  await tryVerify(c.usdc, []);
  await tryVerify(c.governor, [c.fractionToken, c.estateNFT, c.market, 1, 1800, 600, 10, 10]);

  console.log('\n=== Amoy 部署完成 ===');
  console.log(JSON.stringify(c, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
