// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol';
import '@openzeppelin/contracts/token/ERC1155/IERC1155.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

interface IEstateNFT {
    function markFractionalized(uint256 tokenId) external;
    function markRedeemed(uint256 tokenId) external;
    function isFractionalized(uint256 tokenId) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IFractionToken {
    function mint(address to, uint256 tokenId, uint256 amount) external;
    function burn(address from, uint256 tokenId, uint256 amount) external;
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

/**
 * @title EstateMarket
 * @dev 核心市场合约：拆分、买卖挂单、租金分发、赎回合并。
 */
contract EstateMarket is Ownable, ReentrancyGuard, IERC721Receiver {
    IEstateNFT public estateNFT;
    IFractionToken public fractionToken;

    // 卖单
    struct SellOrder {
        address seller;
        uint256 tokenId;
        uint256 amount;
        uint256 pricePerShare; // wei
        bool active;
    }
    SellOrder[] public sellOrders;
    mapping(uint256 => uint256) public orderIdByIndex; // 辅助索引，此处简化为数组索引

    // 房产已拆分的总份额
    mapping(uint256 => uint256) public totalFractions;

    // 每份累计已领取租金（用于差额计算）
    mapping(uint256 => uint256) public dividendPerShare;

    // 用户待领取租金
    mapping(address => mapping(uint256 => uint256)) public pendingDividends;

    // 用户每份已结算租金快照
    mapping(address => mapping(uint256 => uint256)) public userDividendSnapshot;

    event Fractionalized(
        uint256 indexed tokenId,
        address indexed owner,
        uint256 totalShares
    );
    event SellOrderCreated(
        uint256 indexed orderId,
        address indexed seller,
        uint256 indexed tokenId,
        uint256 amount,
        uint256 pricePerShare
    );
    event SellOrderCancelled(uint256 indexed orderId, address indexed seller);
    event SharesBought(
        uint256 indexed orderId,
        address indexed buyer,
        uint256 amount,
        uint256 totalPrice
    );
    event DividendDeposited(uint256 indexed tokenId, uint256 amount);
    event DividendClaimed(
        address indexed user,
        uint256 indexed tokenId,
        uint256 amount
    );
    event Redeemed(uint256 indexed tokenId, address indexed redeemer);

    constructor(address _estateNFT, address _fractionToken) Ownable(msg.sender) {
        require(_estateNFT != address(0) && _fractionToken != address(0), 'Market: zero address');
        estateNFT = IEstateNFT(_estateNFT);
        fractionToken = IFractionToken(_fractionToken);
    }

    // 接受 EstateNFT 在拆分时托管转入的 ERC721
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ==================== 拆分 ====================

    /**
     * @dev 房主将房产 NFT 拆分为等额份额
     * @param tokenId 房产 NFT 的 tokenId
     * @param totalShares 拆分的总份额
     */
    function fractionalize(uint256 tokenId, uint256 totalShares) external nonReentrant {
        require(totalShares > 0, 'Market: zero shares');
        require(!estateNFT.isFractionalized(tokenId), 'Market: already fractionalized');
        require(
            estateNFT.ownerOf(tokenId) == msg.sender,
            'Market: not token owner'
        );

        // 将 NFT 转入 Market 托管
        IERC721(address(estateNFT)).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );

        totalFractions[tokenId] = totalShares;
        estateNFT.markFractionalized(tokenId);
        fractionToken.mint(msg.sender, tokenId, totalShares);

        emit Fractionalized(tokenId, msg.sender, totalShares);
    }

    // ==================== 二级市场 ====================

    /**
     * @dev 用户挂卖单出售所持份额
     */
    function createSellOrder(
        uint256 tokenId,
        uint256 amount,
        uint256 pricePerShare
    ) external nonReentrant returns (uint256 orderId) {
        require(amount > 0, 'Market: zero amount');
        require(pricePerShare > 0, 'Market: zero price');
        require(
            fractionToken.balanceOf(msg.sender, tokenId) >= amount,
            'Market: insufficient balance'
        );

        // 授权检查：本合约是否有权转移用户份额
        require(
            IERC1155(address(fractionToken)).isApprovedForAll(msg.sender, address(this)),
            'Market: not approved'
        );

        orderId = sellOrders.length;
        sellOrders.push(
            SellOrder({
                seller: msg.sender,
                tokenId: tokenId,
                amount: amount,
                pricePerShare: pricePerShare,
                active: true
            })
        );

        emit SellOrderCreated(orderId, msg.sender, tokenId, amount, pricePerShare);
    }

    /**
     * @dev 取消卖单
     */
    function cancelSellOrder(uint256 orderId) external nonReentrant {
        SellOrder storage order = sellOrders[orderId];
        require(order.active, 'Market: order inactive');
        require(order.seller == msg.sender, 'Market: not seller');

        order.active = false;
        emit SellOrderCancelled(orderId, msg.sender);
    }

    /**
     * @dev 购买份额
     */
    function buyShares(uint256 orderId, uint256 amount) external payable nonReentrant {
        SellOrder storage order = sellOrders[orderId];
        require(order.active, 'Market: order inactive');
        require(amount > 0 && amount <= order.amount, 'Market: invalid amount');

        uint256 totalPrice = amount * order.pricePerShare;
        require(msg.value == totalPrice, 'Market: incorrect value');

        // 更新待领取分红快照（买卖双方）
        _updateDividend(order.seller, order.tokenId);
        _updateDividend(msg.sender, order.tokenId);

        // 转移份额
        IERC1155(address(fractionToken)).safeTransferFrom(
            order.seller,
            msg.sender,
            order.tokenId,
            amount,
            ''
        );

        // 转账给卖家
        (bool sent, ) = payable(order.seller).call{value: totalPrice}('');
        require(sent, 'Market: transfer failed');

        order.amount -= amount;
        if (order.amount == 0) {
            order.active = false;
        }

        emit SharesBought(orderId, msg.sender, amount, totalPrice);
    }

    // ==================== 租金分红 ====================

    /**
     * @dev 运营方注入租金（链下结算后上链）
     */
    function depositRent(uint256 tokenId) external payable onlyOwner {
        require(estateNFT.isFractionalized(tokenId), 'Market: not fractionalized');
        require(msg.value > 0, 'Market: zero rent');
        require(totalFractions[tokenId] > 0, 'Market: no fractions');

        uint256 added = msg.value / totalFractions[tokenId];
        dividendPerShare[tokenId] += added;

        emit DividendDeposited(tokenId, msg.value);
    }

    /**
     * @dev 用户领取累计待分红
     */
    function claimDividend(uint256 tokenId) external nonReentrant {
        _updateDividend(msg.sender, tokenId);
        uint256 amount = pendingDividends[msg.sender][tokenId];
        require(amount > 0, 'Market: no dividend');

        pendingDividends[msg.sender][tokenId] = 0;
        (bool sent, ) = payable(msg.sender).call{value: amount}('');
        require(sent, 'Market: claim failed');

        emit DividendClaimed(msg.sender, tokenId, amount);
    }

    function _updateDividend(address user, uint256 tokenId) internal {
        uint256 snapshot = userDividendSnapshot[user][tokenId];
        uint256 current = dividendPerShare[tokenId];
        if (current > snapshot) {
            uint256 delta = current - snapshot;
            uint256 balance = fractionToken.balanceOf(user, tokenId);
            pendingDividends[user][tokenId] += balance * delta;
            userDividendSnapshot[user][tokenId] = current;
        }
    }

    // ==================== 赎回 ====================

    /**
     * @dev 持有全部份额的用户可赎回合并为完整 NFT
     */
    function redeem(uint256 tokenId) external nonReentrant {
        require(estateNFT.isFractionalized(tokenId), 'Market: not fractionalized');
        require(
            fractionToken.balanceOf(msg.sender, tokenId) == totalFractions[tokenId],
            'Market: not full ownership'
        );

        _updateDividend(msg.sender, tokenId);

        // 销毁全部份额
        fractionToken.burn(msg.sender, tokenId, totalFractions[tokenId]);

        // 归还 NFT
        estateNFT.markRedeemed(tokenId);
        IERC721(address(estateNFT)).safeTransferFrom(address(this), msg.sender, tokenId);

        totalFractions[tokenId] = 0;

        emit Redeemed(tokenId, msg.sender);
    }

    // ==================== 查询 ====================

    function getSellOrder(uint256 orderId) external view returns (SellOrder memory) {
        return sellOrders[orderId];
    }

    function getSellOrderCount() external view returns (uint256) {
        return sellOrders.length;
    }

    function getPendingDividend(address user, uint256 tokenId) external view returns (uint256) {
        uint256 snapshot = userDividendSnapshot[user][tokenId];
        uint256 current = dividendPerShare[tokenId];
        uint256 delta = current > snapshot ? current - snapshot : 0;
        uint256 balance = fractionToken.balanceOf(user, tokenId);
        return pendingDividends[user][tokenId] + balance * delta;
    }

    receive() external payable {
        revert('Market: direct deposit not allowed');
    }
}
