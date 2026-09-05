require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || '';
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';

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
    amoy: {
      url: 'https://polygon-amoy-bor-rpc.publicnode.com',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
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
