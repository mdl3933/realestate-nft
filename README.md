# 碎片化不动产 NFT 权益交易系统（ESTATE）

将商业地产拆分为 ERC-1155 碎片化权益代币，支持房产 NFT 铸造、碎片化、份额买卖、租金分红与赎回合并。**无需 MetaMask**：用户使用账号密码登录，后端托管加密钱包并代为签名上链。

## 技术栈

- **前端**：原生 HTML + Tailwind（浏览器版）+ 暖金奢华设计风格，7 个页面
- **后端**：Node.js + Express + ethers.js，JWT 认证，AES-256-GCM 加密托管私钥，JSON 文件存储
- **智能合约**：Solidity 0.8.26 + OpenZeppelin + Hardhat
  - `EstateNFT`（ERC-721）：房产凭证
  - `FractionToken`（ERC-1155）：碎片化份额
  - `EstateMarket`：碎片化、挂单、交易、分红、赎回
- **本地区块链**：Hardhat 内置节点（chainId 31337，RPC `http://127.0.0.1:8545`）

## 目录结构

```
realestate-nft-fraction/      前端设计工程（7 页面 + .design 画布 + 房产图片）
  ├─ pages/                   首页/在售资产/拆分/交易/收益/赎回/个人中心
  └─ assets/                  图片、api.js、auth.js、contracts.json
backend/                      Express 后端（托管钱包、链上签名、API）
  ├─ src/server.js            API 路由与静态托管
  ├─ src/blockchain.js        ethers 合约交互
  ├─ src/db.js                JSON 文件数据库
  └─ src/crypto.js            私钥加解密
realestate-nft-contracts/     Hardhat 智能合约工程
  ├─ contracts/               EstateNFT / FractionToken / EstateMarket
  └─ scripts/deploy-local.js  本地部署脚本（自动写入合约地址）
serve-design.js               零依赖前端预览服务器
deploy-to-github.js           一键部署到 GitHub 脚本
```

## 本地部署步骤

需要 Node.js 18+。

### 1. 启动本地区块链节点

```bash
cd realestate-nft-contracts
npm install
npx hardhat node
```

保持窗口运行，节点提供 20 个测试账户（每个 10000 ETH）。

### 2. 部署合约到本地节点

新开一个终端：

```bash
cd realestate-nft-contracts
npx hardhat run scripts/deploy-local.js --network localhost
```

脚本会自动把合约地址写入 `backend/.env` 和 `realestate-nft-fraction/assets/contracts.json`。

### 3. 启动后端

```bash
cd backend
npm install
npm start
```

后端监听 `http://127.0.0.1:3001`，同时托管 API 与前端页面。
首次启动前需配置 `backend/.env`（参考 `.env.example`），至少包含 `JWT_SECRET`、`ENCRYPTION_KEY`、`RPC_URL` 与三个合约地址。

### 4. 访问前端

- 后端托管：直接打开 `http://127.0.0.1:3001/pages/index.html`
- 或独立预览：在项目根目录运行 `node serve-design.js`，打开 `http://127.0.0.1:8080/pages/index.html`

## 核心流程

1. 注册账号（自动创建钱包并发放 0.1 测试 ETH）
2. 铸造房产 NFT（ERC-721）
3. 碎片化为 N 份（ERC-1155，NFT 锁定到市场合约）
4. 挂卖单 / 购买份额
5. 管理员存入租金，按持仓比例分红，持有者领取
6. 收齐全部份额后赎回原始 NFT

## 安全说明

- `backend/.env`、`realestate-nft-contracts/.env` 含私钥与密钥，**严禁提交到仓库**（已在 `.gitignore` 排除）。
- 用户私钥使用 AES-256-GCM 加密存储，密钥由 `ENCRYPTION_KEY` 经 PBKDF2 派生。
- 本项目默认配置为本地演示，部署到公链或生产环境前请替换所有密钥、私钥与 RPC。
