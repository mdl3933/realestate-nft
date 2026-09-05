# ESTATE — 碎片化不动产 NFT 权益交易系统

将商业地产拆分为 ERC-1155 碎片化权益代币，覆盖房产 NFT 铸造、碎片化、份额买卖、租金分红与赎回合并全流程。前端为暖金奢华风 7 页面，无需 MetaMask，配合 Hardhat 本地区块链即可完整体验。

## 在线预览（GitHub Pages）

打开即运行（纯前端 UI，可浏览全部页面与交互样式）：

**https://mdl3933.github.io/realestate-nft/**

> 说明：在线版为前端界面演示，链上交易需在本地启动 Hardhat 节点后运行（见下文）。

## 目录结构

```
realestate-nft-fraction/      前端工程（7 页面 + 设计令牌 + 房产图片）
  ├─ pages/                   index/marketplace/split/trade/yield/redeem/profile
  ├─ assets/                  房产主视觉图片
  ├─ partials/                页面外壳模板
  └─ colors_and_type.css      暖金设计令牌
realestate-nft-contracts/     Hardhat 智能合约工程
  ├─ contracts/               EstateNFT(ERC721) / FractionToken(ERC1155) / EstateMarket
  ├─ scripts/deploy.js        Polygon Amoy 测试网部署脚本
  └─ hardhat.config.js        Solidity 0.8.26 / cancun
```

## 本地运行

需要 Node.js 18+。

### 1. 浏览前端（无需区块链）

前端为纯静态页面，任意静态服务器即可，例如：

```bash
cd realestate-nft-fraction
npx serve .            # 或 python -m http.server
# 浏览器打开 pages/index.html
```

### 2. 编译并部署合约到本地节点

```bash
cd realestate-nft-contracts
npm install
npx hardhat node                 # 终端 A：启动本地链（chainId 31337，20 个测试账户）
npx hardhat compile              # 终端 B：编译合约
```

部署到 Polygon Amoy 测试网：

```bash
# 复制 .env.example 为 .env，填入测试钱包私钥
cp .env.example .env
npm run deploy:amoy
```

`.env` 只需一个变量：

```
PRIVATE_KEY=你的测试钱包私钥（切勿使用主网资产钱包）
POLYGONSCAN_API_KEY=可选，用于合约验证
```

## 安全提示

- `realestate-nft-contracts/.env` 含私钥，已通过 `.gitignore` 排除，**不会**提交到仓库。
- 测试网/本地演示私钥请勿存放主网资产。
