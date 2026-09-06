# 房产 NFT 份额化交易平台（RealEstate NFT Fraction）

把一处房产铸成 NFT，再拆分成若干份额（ERC20）进行认购、买卖、分红与赎回的全栈演示项目。
**无需 MetaMask**：用户用用户名 + 密码注册，后端为其创建并托管链上钱包（私钥经 AES 加密保存），下单由后端签名上链。

## 在线预览
- 首页：https://mdl3933.github.io/realestate-nft/
- 份额交易页：https://mdl3933.github.io/realestate-nft/realestate-nft-fraction/pages/trade.html

> 在线 GitHub Pages 为纯静态演示：注册登录、下单、订单记录与跳转、CSV 导出均可用，数据保存在浏览器本地（localStorage）。
> 真实链上交易在本地运行后端 + Hardhat 节点时生效。

## 目录结构
- `realestate-nft-fraction/`：前端（原生 HTML + Tailwind，本地加载），数据层 `assets/app.js`
- `realestate-nft-contracts/`：Solidity 合约（EstateNFT / FractionToken / EstateMarket）+ Hardhat 部署脚本
- `backend/`：Node.js + Express + ethers v6 后端，托管钱包、订单上链、托管前端

## 主要功能
- **订单记录与跳转**：提交买/卖/拆分/分红/赎回后自动记录订单、更新持仓、跳转个人中心并高亮最新订单。
- **订单导出 CSV**：个人中心「导出订单 CSV」按钮；链上模式含交易哈希，带 BOM 中文表头，Excel 直接打开不乱码。
- **会话持久化**：登录态加密落盘，**后端重启免登录**；退出登录会同时清除服务端会话。
- **免插件钱包**：用户名密码注册，后端创建托管钱包，自动发放测试 ETH。
- **链上交易**：买单/卖单通过 EstateMarket 合约成交，持仓从链上 `balanceOf` 实时读取。

## 本地启动（三个终端）
```bash
# 终端1：本地区块链节点（chainId 31337）
cd realestate-nft-contracts
npm install
npx hardhat node

# 终端2：部署合约 + 种子数据（4 套房产，各拆 1000 份并挂卖单）
cd realestate-nft-contracts
npx hardhat run scripts/deploy-local.js --network localhost

# 终端3：后端（同时托管前端，访问 http://127.0.0.1:3001/pages/index.html）
cd backend
npm install
npm start
```
后端配置见 `backend/.env.example`（复制为 `.env`，含 RPC_URL 与三个合约地址）。

## 主要 API
- `POST /api/auth/register|login|logout`：注册 / 登录 / 退出
- `GET  /api/me`：当前用户信息、ETH 余额、链上持仓
- `POST /api/orders`：提交订单（买/卖/拆分/分红/赎回），后端签名上链
- `GET  /api/orders`：订单流水
- `GET  /api/orders/export`：导出订单 CSV
- `GET  /api/health`：节点与合约状态

## 安全说明
- 用户私钥以 keystore 形式用密码 AES 加密保存；持久化会话用服务器主密钥（`data/.masterkey`）AES-256-GCM 加密。
- `.env`、`data/db.json`、`data/.masterkey`、`node_modules` 均已在 `.gitignore` 中，不会上传仓库。
- 本项目为本地演示，合约部署在 Hardhat 本地网络，请勿在主网使用。
