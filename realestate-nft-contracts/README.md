# 碎片化不动产 NFT 权益交易合约（RWA）

基于 ERC721 + ERC1155 的房产碎片化（Real World Asset）合约工程，覆盖 **拆分 → 二级市场交易 → 租金分红 → 赎回合并** 全流程，并集成 **Chainlink 预言机报价、美元稳定币结算、DAO 治理、IPFS 元数据存证**。可本地 Hardhat 一键演示，也可部署 Polygon Amoy 测试网。

## 合约结构

| 合约                           | 标准      | 说明                                                   |
| ---------------------------- | ------- | ---------------------------------------------------- |
| `EstateNFT.sol`              | ERC721  | 房产主 NFT，代表完整不动产所有权                                   |
| `FractionToken.sol`          | ERC1155 | 份额代币，tokenId 与房产 NFT 一一对应                            |
| `EstateMarket.sol`           | 自定义     | 拆分、二级市场买卖、租金分红、赎回合并（ReentrancyGuard 防重入）             |
| `RwaPriceOracle.sol`         | 自定义     | 接入 Chainlink ETH/USD 喂价，把房产美元报价换算为链上 ETH 金额；馈送过期自动拒绝 |
| `mocks/MockV3Aggregator.sol` | Mock    | 本地/测试用 Chainlink 聚合器（测试网替换为真实喂价地址）                   |
| `mocks/MockUSDC.sol`         | ERC20   | 6 位小数美元稳定币，带水龙头，用于法币本位结算                             |
| `EstateGovernor.sol`         | 自定义 DAO | 份额即选票：提案 / 投票 / 法定人数 / 内置时间锁 / 执行，可接管合约所有权           |

## 竞赛技术亮点

1. **完整 RWA 闭环**：真实房产 → ERC721 确权 → ERC1155 碎片化 → 自由交易 → 租金分红 → 集齐赎回，资产始终 1:1 托管。
2. **Chainlink 预言机定价**：房产以美元估值，合约通过 ETH/USD 喂价实时换算为链上应付 ETH；价格馈送过期（>1 天）直接 revert，杜绝陈旧报价。
3. **稳定币结算**：提供 6 位小数 USDC 合约，支持法币本位计价，降低加密币波动对不动产估值的干扰。
4. **链上 DAO 治理**：份额持有者即治理者，权重 = 名下所有房产份额总和；含提案阈值、法定人数比例、投票期与时间锁，治理通过后可直接调用市场/NFT 合约（如转移所有权、调整参数）。
5. **IPFS 元数据存证**：房产 metadata 标准 JSON，可 pin 到 IPFS 得到 `ipfs://<cid>`，无节点时用 base64 data URI 链上兜底。
6. **工程化与可验证**：18 个 Hardhat 单元测试覆盖正常流程与异常回滚；GitHub Actions CI 自动编译 + 跑测试；支持 polygonscan 源码验证。
7. **免插件体验**：后端托管加密钱包，用户无需安装 MetaMask 即可体验完整链上流程。

## 前置准备

```powershell
npm install
cp .env.example .env   # 部署测试网时填写 PRIVATE_KEY / POLYGONSCAN_API_KEY
```

测试网需要 Amoy POL（水龙头：<https://faucet.polygon.technology> ）。

## 常用命令

```bash
# 编译
npm run compile

# 单元测试（18 个用例：拆分/交易/分红/赎回/异常 + 预言机/稳定币/DAO）
npx hardhat test

# 本地区块链一键部署（全套合约 + 4 套房产种子数据 + 预言机美元报价）
# 终端1: npx hardhat node
# 终端2: npx hardhat run scripts/deploy-local.js --network localhost

# 生成 IPFS 元数据（有本地 IPFS 节点则自动 pin，否则 base64 兜底）
node scripts/ipfs-metadata.js

# 部署 Polygon Amoy（可选 ETH_USD_FEED 指定真实 Chainlink 喂价，否则用 Mock）
npm run deploy:amoy
```

部署后地址会自动写入 `backend/.env` 与 `realestate-nft-fraction/assets/contracts.json`，前端/后端开箱即用。

## 核心交互流程

### 房主：铸造并拆分房产

```js
const estateNFT = await ethers.getContractAt('EstateNFT', EstateNFT_ADDRESS);
const market = await ethers.getContractAt('EstateMarket', Market_ADDRESS);

const tx1 = await estateNFT.mintProperty(owner, 'ipfs://Qm...');
await tx1.wait();
const tokenId = await estateNFT.totalSupply() - 1n;
await estateNFT.approve(Market_ADDRESS, tokenId);
const tx3 = await market.fractionalize(tokenId, 100);
await tx3.wait();
```

### 用户：购买份额

```js
const market = await ethers.getContractAt('EstateMarket', Market_ADDRESS);
const order = await market.getSellOrder(0);
const totalPrice = order.pricePerShare * 5n;
await market.buyShares(0, 5, { value: totalPrice });
```

### 预言机：美元报价 → 链上 ETH

```js
const oracle = await ethers.getContractAt('RwaPriceOracle', ORACLE_ADDRESS);
await oracle.setSharePriceUsd(tokenId, 60000n * 10n ** 8n); // 每份 $60,000
const weiPerShare = await oracle.getSharePriceWei(tokenId);  // 按 ETH/USD 换算
```

### DAO：提案 → 投票 → 时间锁 → 执行

```js
const gov = await ethers.getContractAt('EstateGovernor', GOV_ADDRESS);
const data = market.interface.encodeFunctionData('transferOwnership', [newOwner]);
await gov.propose([market.target], [0], [data], '提案说明');
await gov.castVote(0, 1);          // 1=赞成 2=反对 3=弃权
// 投票期结束后
await gov.queue(0);                // 入时间锁
await gov.execute(0);              // 时间锁到期后执行
```

### 分红与赎回

```js
await market.depositRent(tokenId, { value: ethers.parseEther('0.1') }); // 运营方注入租金
await market.claimDividend(tokenId);                                     // 份额持有者领取
await market.redeem(tokenId);                                            // 集齐全部份额赎回 NFT
```

## 测试覆盖

`npx hardhat test` 共 18 个用例：

- 核心：拆分托管、重复拆分/非所有者回滚、买卖换手、金额不符/超量回滚、撤单、租金按比例分红、无收益回滚、集齐赎回、未集齐回滚。

- RWA：预言机美元→ETH 换算、馈送过期拒绝、USDC 水龙头与 6 位小数、DAO 投票权重/法定人数、提案阈值、完整治理流程接管所有权、未达法定人数提案失败。

## 安全提示

- `.env` 含私钥，已在 `.gitignore` 中，切勿提交。

- 市场合约使用 `ReentrancyGuard`；NFT 仅允许市场合约铸造/转移份额。

- 生产主网部署前建议完整审计，并将 Mock 喂价/稳定币替换为 Chainlink 真实喂价与合规稳定币。

