/*
 * 共享部署核心：部署全套 RWA 房产分片合约
 *   EstateNFT / FractionToken / EstateMarket
 *   + MockV3Aggregator(Chainlink 喂价) / RwaPriceOracle
 *   + MockUSDC（6 位小数稳定币）
 *   + EstateGovernor（份额即选票 + 内置时间锁）
 * 由 deploy-local.js 与 deploy.js(Amoy) 复用。
 */
const hre = require('hardhat');

async function deployFull(opts = {}) {
  const {
    seed = false,
    ethUsdFeed = null,     // 已有 Chainlink 喂价地址则用之，否则部署 Mock
    initialEthUsd = 3000,  // Mock 初始 ETH/USD 价格
    votingDelay = 0,
    votingPeriod = 300,    // 秒（Governor 基于 block.timestamp）
    timelockDelay = 60,    // 秒
    proposalThreshold = 10,
    quorumPercent = 10,
    properties = []
  } = opts;

  const [deployer] = await hre.ethers.getSigners();
  console.log('部署账户:', deployer.address);

  // 1. 核心三件套
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
  await (await estateNFT.setApprovalForAll(marketAddr, true)).wait();
  await (await fractionToken.setApprovalForAll(marketAddr, true)).wait();
  console.log('核心合约就绪');

  // 2. 预言机：优先用真实 Chainlink 喂价，否则部署 Mock
  let feedAddr = ethUsdFeed;
  if (!feedAddr) {
    const Agg = await hre.ethers.getContractFactory('MockV3Aggregator');
    const mockAgg = await Agg.deploy(8, hre.ethers.parseUnits(String(initialEthUsd), 8));
    await mockAgg.waitForDeployment();
    feedAddr = await mockAgg.getAddress();
    console.log('已部署 MockV3Aggregator（本地喂价）:', feedAddr);
  } else {
    console.log('使用 Chainlink 喂价地址:', feedAddr);
  }
  const Oracle = await hre.ethers.getContractFactory('RwaPriceOracle');
  const oracle = await Oracle.deploy(feedAddr);
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log('RwaPriceOracle 就绪:', oracleAddr);

  // 3. 稳定币（MockUSDC，6 位小数）
  const USDC = await hre.ethers.getContractFactory('MockUSDC');
  const usdc = await USDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log('MockUSDC 就绪:', usdcAddr);

  // 4. DAO 治理（份额即选票 + 内置时间锁）
  const Gov = await hre.ethers.getContractFactory('EstateGovernor');
  const gov = await Gov.deploy(ftAddr, nftAddr, marketAddr, votingDelay, votingPeriod, timelockDelay, proposalThreshold, quorumPercent);
  await gov.waitForDeployment();
  const govAddr = await gov.getAddress();
  console.log('EstateGovernor 就绪:', govAddr);

  // 5. 可选：种子房产（本地演示）
  const seeded = [];
  if (seed && properties.length) {
    for (let i = 0; i < properties.length; i++) {
      const p = properties[i];
      const tokenId = await estateNFT.mintProperty.staticCall(deployer.address, p.uri);
      await (await estateNFT.mintProperty(deployer.address, p.uri)).wait();
      await (await market.fractionalize(tokenId, p.shares)).wait();
      const priceWei = hre.ethers.parseEther(p.priceEth);
      const orderId = await market.createSellOrder.staticCall(tokenId, p.shares, priceWei);
      await (await market.createSellOrder(tokenId, p.shares, priceWei)).wait();
      if (p.priceUsd) {
        await (await oracle.setSharePriceUsd(tokenId, hre.ethers.parseUnits(String(p.priceUsd), 8))).wait();
      }
      console.log('  [' + p.key + '] tokenId=' + tokenId + ' 份额=' + p.shares + ' 卖单#' + orderId + ' 单价=' + p.priceEth + 'ETH $' + (p.priceUsd || '-'));
      seeded.push({ key: p.key, name: p.name, tokenId: Number(tokenId), orderId: Number(orderId), shares: p.shares, priceEth: p.priceEth, priceUsd: p.priceUsd || null });
    }
  }

  return {
    deployer: deployer.address,
    contracts: {
      estateNFT: nftAddr,
      fractionToken: ftAddr,
      market: marketAddr,
      priceFeed: feedAddr,
      priceOracle: oracleAddr,
      usdc: usdcAddr,
      governor: govAddr
    },
    properties: seeded
  };
}

module.exports = { deployFull };
