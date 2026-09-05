const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

function writeBackendEnv(envPath, addresses) {
  let existing = '';
  if (fs.existsSync(envPath)) {
    existing = fs.readFileSync(envPath, 'utf8');
  }
  const lines = existing.split('\n').filter((line) => {
    const key = line.split('=')[0];
    return key && !['CONTRACT_ESTATE_NFT', 'CONTRACT_FRACTION_TOKEN', 'CONTRACT_MARKET', 'RPC_URL', 'CHAIN_ID'].includes(key);
  });
  lines.push(`RPC_URL=http://127.0.0.1:8545`);
  lines.push(`CHAIN_ID=31337`);
  lines.push(`CONTRACT_ESTATE_NFT=${addresses.estateNFT}`);
  lines.push(`CONTRACT_FRACTION_TOKEN=${addresses.fractionToken}`);
  lines.push(`CONTRACT_MARKET=${addresses.market}`);
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
}

function writeContractsJson(jsonPath, addresses) {
  const data = {
    chainId: 31337,
    rpcUrl: 'http://127.0.0.1:8545',
    contracts: {
      EstateNFT: addresses.estateNFT,
      FractionToken: addresses.fractionToken,
      EstateMarket: addresses.market,
    },
  };
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying contracts with account:', deployer.address);
  console.log('Account balance:', hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), 'ETH');

  const EstateNFT = await hre.ethers.getContractFactory('EstateNFT');
  const estateNFT = await EstateNFT.deploy();
  await estateNFT.waitForDeployment();
  const estateNFTAddress = await estateNFT.getAddress();
  console.log('EstateNFT deployed to:', estateNFTAddress);

  const FractionToken = await hre.ethers.getContractFactory('FractionToken');
  const fractionToken = await FractionToken.deploy('https://estatenft.example/api/metadata/{id}.json');
  await fractionToken.waitForDeployment();
  const fractionTokenAddress = await fractionToken.getAddress();
  console.log('FractionToken deployed to:', fractionTokenAddress);

  const EstateMarket = await hre.ethers.getContractFactory('EstateMarket');
  const market = await EstateMarket.deploy(estateNFTAddress, fractionTokenAddress);
  await market.waitForDeployment();
  const marketAddress = await market.getAddress();
  console.log('EstateMarket deployed to:', marketAddress);

  await (await estateNFT.setMarket(marketAddress)).wait();
  console.log('EstateNFT.market set to:', marketAddress);
  await (await fractionToken.setMarket(marketAddress)).wait();
  console.log('FractionToken.market set to:', marketAddress);

  const addresses = {
    estateNFT: estateNFTAddress,
    fractionToken: fractionTokenAddress,
    market: marketAddress,
  };

  const backendEnvPath = path.join(__dirname, '../../backend/.env');
  writeBackendEnv(backendEnvPath, addresses);
  console.log('Backend .env updated:', backendEnvPath);

  const contractsJsonPath = path.join(__dirname, '../../realestate-nft-fraction/assets/contracts.json');
  writeContractsJson(contractsJsonPath, addresses);
  console.log('Frontend contracts.json updated:', contractsJsonPath);

  console.log('\n=== Deployment Summary ===');
  console.log('EstateNFT:', estateNFTAddress);
  console.log('FractionToken:', fractionTokenAddress);
  console.log('EstateMarket:', marketAddress);
  console.log('Deployer:', deployer.address);
  console.log('Network:', hre.network.name);

  console.log('\n=== Hardhat Test Accounts (first 3) ===');
  const mnemonic = 'test test test test test test test test test test test junk';
  const root = hre.ethers.HDNodeWallet.fromPhrase(mnemonic);
  for (let i = 0; i < 3; i++) {
    const wallet = root.derivePath(`m/44'/60'/0'/0/${i}`);
    console.log(`Account ${i}: ${wallet.address}  Private Key: ${wallet.privateKey}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
