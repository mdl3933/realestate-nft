# 碎片化不动产 NFT 权益交易合约

基于 ERC721 + ERC1155 的房产碎片化合约工程，部署于 Polygon Amoy 测试网。

## 合约结构

| 合约 | 标准 | 说明 |
| --- | --- | --- |
| `EstateNFT.sol` | ERC721 | 房产主 NFT，代表完整不动产所有权 |
| `FractionToken.sol` | ERC1155 | 份额代币，tokenId 与房产 NFT 一一对应 |
| `EstateMarket.sol` | 自定义 | 拆分、二级市场买卖、租金分红、赎回合并 |

## 前置准备

1. 复制环境变量文件：

```powershell
cp .env.example .env
```

2. 编辑 `.env`，填入：

```env
PRIVATE_KEY=你的钱包私钥（不含 0x）
POLYGONSCAN_API_KEY=你的 PolygonScan API Key
```

3. 确保钱包中有 Amoy 测试网 MATIC：
   - 水龙头：[https://faucet.polygon.technology](https://faucet.polygon.technology)

## 常用命令

```bash
# 编译合约
npm run compile

# 本地测试（可选）
npx hardhat test

# 部署到 Polygon Amoy 测试网
npm run deploy:amoy

# 验证合约（部署后执行）
npx hardhat verify --network amoy <EstateNFT_ADDRESS>
npx hardhat verify --network amoy <FractionToken_ADDRESS> "https://estatenft.example/api/metadata/{id}.json"
npx hardhat verify --network amoy <EstateMarket_ADDRESS> <EstateNFT_ADDRESS> <FractionToken_ADDRESS>
```

## 核心交互流程

### 房主：铸造并拆分房产

```js
const estateNFT = await ethers.getContractAt('EstateNFT', EstateNFT_ADDRESS);
const market = await ethers.getContractAt('EstateMarket', Market_ADDRESS);

// 1. 铸造
const tx1 = await estateNFT.mintProperty(owner, 'ipfs://Qm...');
await tx1.wait();
const tokenId = await estateNFT.totalSupply() - 1n;

// 2. 授权 Market 操作 NFT
await estateNFT.approve(Market_ADDRESS, tokenId);

// 3. 拆分为 100 份
const tx3 = await market.fractionalize(tokenId, 100);
await tx3.wait();
```

### 用户：购买份额

```js
const market = await ethers.getContractAt('EstateMarket', Market_ADDRESS);
const orderId = 0;
const amount = 5;
const order = await market.getSellOrder(orderId);
const totalPrice = order.pricePerShare * BigInt(amount);

const tx = await market.buyShares(orderId, amount, { value: totalPrice });
await tx.wait();
```

### 用户：挂卖单

```js
const fractionToken = await ethers.getContractAt('FractionToken', FractionToken_ADDRESS);
await fractionToken.setApprovalForAll(Market_ADDRESS, true);

const tx = await market.createSellOrder(tokenId, amount, pricePerShare);
await tx.wait();
```

### 运营方：注入租金

```js
const tx = await market.depositRent(tokenId, { value: ethers.parseEther('0.1') });
await tx.wait();
```

### 用户：领取分红

```js
const tx = await market.claimDividend(tokenId);
await tx.wait();
```

### 用户：赎回合并完整 NFT

```js
const tx = await market.redeem(tokenId);
await tx.wait();
```

## 安全提示

- `.env` 文件包含私钥，切勿提交到 Git。
- 生产环境部署前建议进行完整审计。
- 测试网验证通过后，再考虑主网部署。
