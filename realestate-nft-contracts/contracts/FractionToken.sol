// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import '@openzeppelin/contracts/token/ERC1155/ERC1155.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
 * @title FractionToken
 * @dev 代表房产拆分后等额份额的 ERC1155 合约。
 *      tokenId 与 EstateNFT 的房产 tokenId 一一对应。
 */
contract FractionToken is ERC1155, Ownable {
    // Market 合约地址，拥有铸造/销毁份额权限
    address public market;

    event MarketSet(address indexed market);

    modifier onlyMarket() {
        require(msg.sender == market, 'FractionToken: caller is not market');
        _;
    }

    constructor(string memory uri_) ERC1155(uri_) Ownable(msg.sender) {}

    function setMarket(address _market) external onlyOwner {
        require(_market != address(0), 'FractionToken: zero address');
        market = _market;
        emit MarketSet(_market);
    }

    /**
     * @dev Market 调用：为指定房产铸造份额
     */
    function mint(
        address to,
        uint256 tokenId,
        uint256 amount
    ) external onlyMarket {
        require(to != address(0), 'FractionToken: zero address');
        _mint(to, tokenId, amount, '');
    }

    /**
     * @dev Market 调用：销毁份额（赎回合并时）
     */
    function burn(
        address from,
        uint256 tokenId,
        uint256 amount
    ) external onlyMarket {
        _burn(from, tokenId, amount);
    }

    /**
     * @dev 批量销毁（可选，用于多房产赎回）
     */
    function burnBatch(
        address from,
        uint256[] memory tokenIds,
        uint256[] memory amounts
    ) external onlyMarket {
        _burnBatch(from, tokenIds, amounts);
    }
}
