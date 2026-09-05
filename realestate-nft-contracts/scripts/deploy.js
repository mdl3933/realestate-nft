const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying contracts with account:', deployer.address);
  console.log('Account balance:', hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), 'MATIC');

  // 1. 部署 EstateNFT
  const EstateNFT = await hre.ethers.getContractFactory('EstateNFT');
  const estateNFT = await EstateNFT.deploy();
  await estateNFT.waitForDeployment();
  const estateNFTAddress = await estateNFT.getAddress();
  console.log('EstateNFT deployed to:', estateNFTAddress);

  // 2. 部署 FractionToken
  const FractionToken = await hre.ethers.getContractFactory('FractionToken');
  const fractionToken = await FractionToken.deploy('https://estatenft.example/api/metadata/{id}.json');
  await fractionToken.waitForDeployment();
  const fractionTokenAddress = await fractionToken.getAddress();
  console.log('FractionToken deployed to:', fractionTokenAddress);

  // 3. 部署 EstateMarket
  const EstateMarket = await hre.ethers.getContractFactory('EstateMarket');
  const market = await EstateMarket.deploy(estateNFTAddress, fractionTokenAddress);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log('EstateMarket deployed to:', marketAddress);

  // 4. 设置权限
  await (await estateNFT.setMarket(marketAddress)).wait();
  console.log('EstateNFT.market set to:', marketAddress);

  await (await fractionToken.setMarket(marketAddress)).wait();
  console.log('FractionToken.market set to:', marketAddress);

  console.log('\n=== Deployment Summary ===');
  console.log('EstateNFT:', estateNFTAddress);
  console.log('FractionToken:', fractionTokenAddress);
  console.log('EstateMarket:', marketAddress);
  console.log('Deployer:', deployer.address);
  console.log('Network:', hre.network.name);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
