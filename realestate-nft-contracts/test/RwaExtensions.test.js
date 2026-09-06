const { expect } = require('chai');
const { ethers } = require('hardhat');

async function advance(seconds) {
  await ethers.provider.send('evm_increaseTime', [seconds]);
  await ethers.provider.send('evm_mine', []);
}

describe('RWA 扩展：预言机 / 稳定币 / DAO', function () {
  describe('RwaPriceOracle（Chainlink 喂价）', function () {
    it('美元报价按 ETH/USD 馈送换算为 ETH', async function () {
      const Agg = await ethers.getContractFactory('MockV3Aggregator');
      const agg = await Agg.deploy(8, 3000n * 10n ** 8n); // 1 ETH = $3000
      const Oracle = await ethers.getContractFactory('RwaPriceOracle');
      const oracle = await Oracle.deploy(await agg.getAddress());
      await oracle.setSharePriceUsd(0, 60000n * 10n ** 8n); // 每份 $60,000

      expect(await oracle.ethUsdPrice()).to.equal(3000n * 10n ** 8n);
      // $3000 = 1 ETH
      expect(await oracle.usdToWei(3000n * 10n ** 8n)).to.equal(ethers.parseEther('1'));
      // $60,000 / $3000 = 20 ETH
      expect(await oracle.getSharePriceWei(0)).to.equal(ethers.parseEther('20'));
    });

    it('馈送过期则拒绝报价', async function () {
      const Agg = await ethers.getContractFactory('MockV3Aggregator');
      const agg = await Agg.deploy(8, 3000n * 10n ** 8n);
      const Oracle = await ethers.getContractFactory('RwaPriceOracle');
      const oracle = await Oracle.deploy(await agg.getAddress());
      await advance(2 * 24 * 3600 + 1); // 超过 1 天
      await expect(oracle.ethUsdPrice()).to.be.revertedWith('Oracle: stale feed');
    });
  });

  describe('MockUSDC（6 位小数稳定币）', function () {
    it('水龙头铸造 10,000 USDC，小数位为 6', async function () {
      const USDC = await ethers.getContractFactory('MockUSDC');
      const usdc = await USDC.deploy();
      const [, user] = await ethers.getSigners();
      await usdc.connect(user).faucet();
      expect(await usdc.decimals()).to.equal(6);
      expect(await usdc.balanceOf(user.address)).to.equal(10000n * 10n ** 6n);
    });
  });

  describe('EstateGovernor（份额即选票）', function () {
    let nft, frac, market, gov, owner, alice, bob;

    beforeEach(async function () {
      [owner, alice, bob] = await ethers.getSigners();
      const NFT = await ethers.getContractFactory('EstateNFT');
      const Frac = await ethers.getContractFactory('FractionToken');
      const Market = await ethers.getContractFactory('EstateMarket');
      const Gov = await ethers.getContractFactory('EstateGovernor');
      nft = await NFT.deploy();
      frac = await Frac.deploy('https://ipfs.example/{id}.json');
      market = await Market.deploy(await nft.getAddress(), await frac.getAddress());
      await nft.setMarket(await market.getAddress());
      await frac.setMarket(await market.getAddress());
      // alice 铸造并拆分 1000 份
      await nft.connect(alice).mintProperty(alice.address, 'ipfs://g');
      await nft.connect(alice).setApprovalForAll(await market.getAddress(), true);
      await frac.connect(alice).setApprovalForAll(await market.getAddress(), true);
      await market.connect(alice).fractionalize(0, 1000);
      // 治理参数：0 延迟、100s 投票、50s 时间锁、阈值 100 份、法定 10%
      gov = await Gov.deploy(await frac.getAddress(), await nft.getAddress(), await market.getAddress(), 0, 100, 50, 100, 10);
    });

    it('投票权重 = 持有份额总数，法定人数正确', async function () {
      expect(await gov.getVotes(alice.address)).to.equal(1000n);
      expect(await gov.totalVotingSupply()).to.equal(1000n);
      expect(await gov.quorum()).to.equal(100n); // 10%
    });

    it('未达提案阈值不能提案', async function () {
      const data = market.interface.encodeFunctionData('transferOwnership', [bob.address]);
      await expect(gov.connect(bob).propose([await market.getAddress()], [0], [data], 'x'))
        .to.be.revertedWith('Gov: below threshold');
    });

    it('完整治理流程：提案→投票→时间锁→执行，DAO 接管合约所有权', async function () {
      // 先把市场所有权交给 DAO
      await market.connect(owner).transferOwnership(await gov.getAddress());
      expect(await market.owner()).to.equal(await gov.getAddress());

      const data = market.interface.encodeFunctionData('transferOwnership', [bob.address]);
      const tx = await gov.connect(alice).propose([await market.getAddress()], [0], [data], '将市场所有权移交给 bob');
      const id = Number((await tx.wait()).logs[0].topics[1] === undefined ? 0 : 0); // 提案 id 从 0 开始
      const proposalId = 0;

      // 投票期：alice 投赞成（1000 票 > 法定 100）
      await gov.connect(alice).castVote(proposalId, 1);
      let p = await gov.getProposal(proposalId);
      expect(p.forVotes).to.equal(1000n);

      // 投票期结束 → 成功 → 入队
      await advance(200);
      expect(await gov.state(proposalId)).to.equal(4); // Succeeded
      await gov.queue(proposalId);
      expect(await gov.state(proposalId)).to.equal(5); // Queued

      // 时间锁未到不能执行
      await expect(gov.execute(proposalId)).to.be.revertedWith('Gov: timelock not reached');
      await advance(60);
      await gov.execute(proposalId);
      expect(await gov.state(proposalId)).to.equal(7); // Executed
      expect(await market.owner()).to.equal(bob.address);
    });

    it('赞成票未达法定人数则提案失败', async function () {
      const data = market.interface.encodeFunctionData('transferOwnership', [bob.address]);
      await gov.connect(alice).propose([await market.getAddress()], [0], [data], '无人投票');
      await advance(200);
      expect(await gov.state(0)).to.equal(3); // Defeated
      await expect(gov.queue(0)).to.be.revertedWith('Gov: not succeeded');
    });
  });
});
