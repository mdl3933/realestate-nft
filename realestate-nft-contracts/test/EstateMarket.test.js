const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('EstateMarket 核心流程', function () {
  let nft, frac, market, owner, alice, bob, carol;
  const PRICE = ethers.parseEther('0.01'); // 每份 0.01 ETH

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const NFT = await ethers.getContractFactory('EstateNFT');
    const Frac = await ethers.getContractFactory('FractionToken');
    const Market = await ethers.getContractFactory('EstateMarket');
    nft = await NFT.deploy();
    frac = await Frac.deploy('https://ipfs.example/{id}.json');
    market = await Market.deploy(await nft.getAddress(), await frac.getAddress());
    await nft.setMarket(await market.getAddress());
    await frac.setMarket(await market.getAddress());
  });

  async function mintAndFractionalize(minter, tokenId, shares) {
    await nft.connect(minter).mintProperty(minter.address, 'ipfs://estate-' + tokenId);
    await nft.connect(minter).setApprovalForAll(await market.getAddress(), true);
    await frac.connect(minter).setApprovalForAll(await market.getAddress(), true);
    await market.connect(minter).fractionalize(tokenId, shares);
  }

  it('拆分：NFT 托管到市场并铸造等额份额', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    expect(await nft.ownerOf(0)).to.equal(await market.getAddress());
    expect(await frac.balanceOf(alice.address, 0)).to.equal(1000n);
    expect(await nft.isFractionalized(0)).to.equal(true);
    expect(await market.totalFractions(0)).to.equal(1000n);
  });

  it('拆分：不能重复拆分同一房产', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    await expect(market.connect(alice).fractionalize(0, 1000)).to.be.revertedWith('Market: already fractionalized');
  });

  it('拆分：非房产所有者不能拆分', async function () {
    await nft.connect(alice).mintProperty(alice.address, 'ipfs://x');
    await expect(market.connect(bob).fractionalize(0, 1000)).to.be.revertedWith('Market: not token owner');
  });

  it('交易：挂买单后份额与 ETH 正确换手', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    await market.connect(alice).createSellOrder(0, 100, PRICE);
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await market.connect(bob).buyShares(0, 50, { value: PRICE * 50n });
    const receipt = await tx.wait();
    const gas = receipt.gasUsed * receipt.gasPrice;

    expect(await frac.balanceOf(bob.address, 0)).to.equal(50n);
    const order = await market.getSellOrder(0);
    expect(order.amount).to.equal(50n); // 100 - 50
    expect(order.active).to.equal(true);
    const after = await ethers.provider.getBalance(alice.address);
    expect(after - before + gas).to.be.closeTo(PRICE * 50n, ethers.parseEther('0.0001'));
  });

  it('交易：付款金额不符则回滚', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    await market.connect(alice).createSellOrder(0, 100, PRICE);
    await expect(market.connect(bob).buyShares(0, 50, { value: PRICE * 49n }))
      .to.be.revertedWith('Market: incorrect value');
  });

  it('交易：购买数量超过挂单量则回滚', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    await market.connect(alice).createSellOrder(0, 100, PRICE);
    await expect(market.connect(bob).buyShares(0, 150, { value: PRICE * 150n }))
      .to.be.revertedWith('Market: invalid amount');
  });

  it('交易：卖家可取消挂单', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    await market.connect(alice).createSellOrder(0, 100, PRICE);
    await market.connect(alice).cancelSellOrder(0);
    const order = await market.getSellOrder(0);
    expect(order.active).to.equal(false);
    await expect(market.connect(bob).buyShares(0, 10, { value: PRICE * 10n }))
      .to.be.revertedWith('Market: order inactive');
  });

  it('分红：租金按份额比例分配并可领取', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    await market.connect(alice).createSellOrder(0, 100, PRICE);
    await market.connect(bob).buyShares(0, 50, { value: PRICE * 50n }); // alice 950 / bob 50

    await expect(market.connect(owner).depositRent(0, { value: ethers.parseEther('10') }))
      .to.emit(market, 'DividendDeposited');

    expect(await market.getPendingDividend(bob.address, 0)).to.equal(ethers.parseEther('0.5'));
    expect(await market.getPendingDividend(alice.address, 0)).to.equal(ethers.parseEther('9.5'));

    const before = await ethers.provider.getBalance(bob.address);
    const tx = await market.connect(bob).claimDividend(0);
    const receipt = await tx.wait();
    const gas = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(bob.address);
    expect(after - before + gas).to.be.closeTo(ethers.parseEther('0.5'), ethers.parseEther('0.0001'));
  });

  it('分红：无收益可领时回滚', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    await expect(market.connect(alice).claimDividend(0)).to.be.revertedWith('Market: no dividend');
  });

  it('赎回：集齐全部份额可合并赎回 NFT', async function () {
    await mintAndFractionalize(carol, 0, 100);
    expect(await frac.balanceOf(carol.address, 0)).to.equal(100n);
    await market.connect(carol).redeem(0);
    expect(await nft.ownerOf(0)).to.equal(carol.address);
    expect(await frac.balanceOf(carol.address, 0)).to.equal(0n);
    expect(await nft.isFractionalized(0)).to.equal(false);
  });

  it('赎回：未集齐全部份额不能赎回', async function () {
    await mintAndFractionalize(alice, 0, 1000);
    await market.connect(alice).createSellOrder(0, 100, PRICE);
    await market.connect(bob).buyShares(0, 50, { value: PRICE * 50n });
    await expect(market.connect(alice).redeem(0)).to.be.revertedWith('Market: not full ownership');
  });
});
