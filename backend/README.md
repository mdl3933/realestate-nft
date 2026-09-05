# ESTATE 后端服务

房产 NFT 碎片化项目的 Node.js/Express 后端，负责用户认证、托管以太坊钱包、签名交易并与本地 Hardhat 网络交互。

## 功能

- 用户名/密码注册与登录（JWT）
- 为每个用户自动生成并托管以太坊钱包（AES-256-GCM 加密私钥）
- 用户注册时自动从部署者账户发放少量测试 ETH 作为 gas
- 读取 Hardhat 编译产物（artifacts）中的合约 ABI
- 提供房产铸造、拆分、挂单、购买、收益领取、赎回等 REST API

## 环境要求

- Node.js >= 18
- 已运行本地 Hardhat 节点（`npx hardhat node`）
- 已部署合约并生成 `backend/.env`

## 安装

在 `backend` 目录中执行：

```bash
cd backend
npm install
```

## 配置

复制示例环境文件并修改：

```bash
cp .env.example .env
```

关键配置项：

| 变量 | 说明 |
|------|------|
| `PORT` | 后端端口，默认 `3001` |
| `JWT_SECRET` | 签名 JWT 的密钥，至少 32 位随机字符串 |
| `ENCRYPTION_KEY` | 加密用户私钥的密钥，建议与 `JWT_SECRET` 不同 |
| `RPC_URL` | Hardhat 本地节点 RPC，默认 `http://127.0.0.1:8545` |
| `CHAIN_ID` | 本地网络链 ID，默认 `31337` |
| `CONTRACT_ESTATE_NFT` | EstateNFT 合约地址 |
| `CONTRACT_FRACTION_TOKEN` | FractionToken 合约地址 |
| `CONTRACT_MARKET` | EstateMarket 合约地址 |
| `DEPLOYER_PRIVATE_KEY` | 部署者/管理员私钥，用于发放 gas 与注入租金 |

> 运行 `npm run deploy:localhost`（在 `realestate-nft-contracts` 目录）会自动把合约地址写入 `backend/.env` 与 `realestate-nft-fraction/assets/contracts.json`。

## 启动

```bash
npm start
```

服务默认监听 `http://127.0.0.1:3001`。

## API 概览

### 认证

- `POST /api/auth/register` — 注册 `{ username, password }`
- `POST /api/auth/login` — 登录 `{ username, password }`
- `GET /api/me` — 当前用户信息（需 JWT）

### 房产

- `GET /api/properties` — 房产列表
- `POST /api/properties/mint` — 铸造 `{ name, location, description?, imageUri? }`
- `POST /api/properties/fractionalize` — 拆分 `{ tokenId, totalShares }`
- `POST /api/properties/redeem` — 赎回 `{ tokenId }`

### 交易

- `GET /api/orders` — 活跃卖单列表
- `POST /api/orders` — 创建卖单 `{ tokenId, amount, pricePerShareWei }`
- `POST /api/orders/:orderId/buy` — 购买 `{ amount }`

### 收益

- `GET /api/dividends/pending/:tokenId` — 待领取收益
- `POST /api/dividends/claim/:tokenId` — 领取收益
- `POST /api/admin/deposit-rent` — 注入租金 `{ tokenId, amountWei }`

### 其他

- `GET /api/balance/:tokenId` — 当前用户某房产份额余额
- `POST /api/faucet` — 手动领取测试 ETH
- `GET /api/health` — 健康检查

所有受保护接口需在请求头中携带 `Authorization: Bearer <token>`。
