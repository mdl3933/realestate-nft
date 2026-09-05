require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';

// Hardhat local node default account #0 private key (for localhost fallback only)
const LOCALHOST_ACCOUNT_0 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function normalizePrivateKey(key) {
  key = key.trim();
  return key.startsWith('0x') ? key : `0x${key}`;
}

function isValidPrivateKey(key) {
  if (!key) return false;
  key = key.trim();
  const hex = key.startsWith('0x') ? key.slice(2) : key;
  return /^[0-9a-fA-F]{64}$/.test(hex);
}

function getAccounts(fallbackKey) {
  if (isValidPrivateKey(PRIVATE_KEY)) {
    return [normalizePrivateKey(PRIVATE_KEY)];
  }
  return fallbackKey ? [fallbackKey] : [];
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      evmVersion: 'cancun'
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
      accounts: getAccounts(LOCALHOST_ACCOUNT_0)
    },
    amoy: {
      url: 'https://polygon-amoy-bor-rpc.publicnode.com',
      accounts: getAccounts(),
      chainId: 80002
    }
  },
  etherscan: {
    apiKey: {
      polygonAmoy: POLYGONSCAN_API_KEY
    },
    customChains: [
      {
        network: 'polygonAmoy',
        chainId: 80002,
        urls: {
          apiURL: 'https://api-amoy.polygonscan.com/api',
          browserURL: 'https://amoy.polygonscan.com'
        }
      }
    ]
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts'
  }
};
