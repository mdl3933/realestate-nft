require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

const RAW_KEY = process.env.PRIVATE_KEY || '';
// 仅当私钥为合法 32 字节（64 位十六进制）时才用于测试网，否则本地节点用默认账户
const PRIVATE_KEY = /^(0x)?[0-9a-fA-F]{64}$/.test(RAW_KEY)
  ? (RAW_KEY.startsWith('0x') ? RAW_KEY : '0x' + RAW_KEY)
  : '';
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY || '';

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'cancun'
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: process.env.RPC_URL || 'http://127.0.0.1:8545',
      chainId: 31337
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || 'https://polygon-amoy-bor-rpc.publicnode.com',
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 80002
    }
  },
  etherscan: {
    apiKey: { polygonAmoy: POLYGONSCAN_API_KEY },
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
