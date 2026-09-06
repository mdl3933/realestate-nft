# ESTATE — 碎片化不动产 NFT 权益交易系统

将商业地产拆分为 ERC-1155 碎片化权益代币，覆盖房产 NFT 铸造、碎片化、份额买卖、租金分红与赎回合并全流程。**用户名 + 密码登录，平台托管钱包，无需安装 MetaMask。**

## 在线预览（GitHub Pages）

打开即用（前端演示模式，订单用浏览器本地存储记录并跳转）：

**https://mdl3933.github.io/realestate-nft/realestate-nft-fraction/pages/trade.html**

> 在线版可完整体验：注册/登录、提交买/卖单、订单记录、跳转个人中心、持仓与收益展示。
> 链上交易需在本地按下面步骤启动 Hardhat 节点 + 后端。

## 目录结构

```
realestate-nft-fraction/      前端（7 页面 + assets/app.js 数据层 + 房产图片）
realestate-nft-contracts/     Hardhat 智能合约（EstateNFT / FractionToken / EstateMarket）
backend/                      Express 后端（托管钱包、订单签名上链、托管前端静态页）
```

## 本地全链路运行（真实区块链，无需 MetaMask）

需要 Node.js 18+。开 **3 个终端**：

### 终端 1：启动本地区块链

```bash
cd realestate-nft-contracts
npm install
npx hardhat node
```

### 终端 2：部署合约 + 种子数据

```bash
cd realestate-nft-contracts
npx hardhat run scripts/deploy-local.js --network localhost
```

脚本会部署 3 个合约、铸造 4 套房产、各拆分为 1000 份并挂出卖单，
同时把合约地址写入 `backend/.env` 与 `realestate-nft-fraction/assets/contracts.json`。

### 终端 3：启动后端（自动托管前端）

```bash
cd backend
npm install
npm start
```

然后浏览器打开 **http://127.0.0.1:3001/pages/index.html**

- 右上角「登录 / 注册」：用户名 + 密码即可，后端自动创建链上托管钱包。
- 余额不足时下单会自动领取测试币。
- 在「份额交易」提交买单，订单由托管钱包签名上链，成交后自动跳转个人中心，
  持仓从链上 `balanceOf` 读取。

## 仅浏览前端（不启动区块链）

前端为纯静态页面，订单走浏览器本地存储：

```bash
cd realestate-nft-fraction
npx serve .
```

或直接使用 GitHub Pages 在线链接。

## 部署到 Polygon Amoy 测试网（可选）

```bash
cd realestate-nft-contracts
cp .env.example .env   # 填入测试钱包 PRIVATE_KEY
npm run deploy:amoy
```

## 安全说明

- 用户私钥以 keystore 形式加密保存在后端 `data/`（已 gitignore），密码不入库。
- `backend/.env`、`contracts/.env`、`node_modules`、`data/db.json`、合约编译产物均不会提交。
- 本地 Hardhat 账户私钥为公开测试密钥，请勿在主网使用。
