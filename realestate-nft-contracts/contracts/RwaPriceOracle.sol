// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import '@openzeppelin/contracts/access/Ownable.sol';

interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

/**
 * @title RwaPriceOracle
 * @dev RWA 估值与汇率预言机：
 *      - 每套房产的每份份额以美元计价（8 位小数，由评估/审计方 setSharePriceUsd 上链）；
 *      - 通过 Chainlink ETH/USD 馈送将美元报价换算为链上结算所需的 ETH，
 *        从而实现“房产法币计价、链上自动换算”，并对馈送做时效性校验。
 */
contract RwaPriceOracle is Ownable {
    AggregatorV3Interface public ethUsdFeed;

    /// @dev 喂送最大允许延迟，超过则视为过期
    uint256 public constant FEED_STALENESS = 1 days;

    /// @dev tokenId => 每份份额美元价格（8 位小数）
    mapping(uint256 => uint256) public sharePriceUsd;

    event ValuationSet(uint256 indexed tokenId, uint256 priceUsd8);
    event FeedUpdated(address indexed feed);

    constructor(address _feed) Ownable(msg.sender) {
        require(_feed != address(0), 'Oracle: zero feed');
        ethUsdFeed = AggregatorV3Interface(_feed);
    }

    function setFeed(address _feed) external onlyOwner {
        require(_feed != address(0), 'Oracle: zero feed');
        ethUsdFeed = AggregatorV3Interface(_feed);
        emit FeedUpdated(_feed);
    }

    /// @dev 评估方上链/更新房产份额美元估值
    function setSharePriceUsd(uint256 tokenId, uint256 priceUsd8) external onlyOwner {
        require(priceUsd8 > 0, 'Oracle: zero price');
        sharePriceUsd[tokenId] = priceUsd8;
        emit ValuationSet(tokenId, priceUsd8);
    }

    /// @dev 读取 Chainlink ETH/USD 价格（8 位小数），含过期校验
    function ethUsdPrice() public view returns (uint256) {
        (, int256 answer, , uint256 updatedAt, ) = ethUsdFeed.latestRoundData();
        require(answer > 0, 'Oracle: invalid price');
        require(block.timestamp - updatedAt <= FEED_STALENESS, 'Oracle: stale feed');
        return uint256(answer);
    }

    /// @dev 美元金额（8 位小数）换算为 ETH（wei，18 位小数）
    function usdToWei(uint256 usdAmount8) public view returns (uint256) {
        uint256 ethPrice8 = ethUsdPrice();
        return (usdAmount8 * 1e18) / ethPrice8;
    }

    /// @dev 某套房产每份份额的 ETH 结算价（wei）
    function getSharePriceWei(uint256 tokenId) external view returns (uint256) {
        uint256 p = sharePriceUsd[tokenId];
        require(p > 0, 'Oracle: valuation not set');
        return usdToWei(p);
    }
}
