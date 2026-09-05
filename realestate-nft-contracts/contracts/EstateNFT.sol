// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
 * @title EstateNFT
 * @dev 代表完整不动产所有权的 ERC721 合约。
 *      每个 tokenId 对应一套房产，由 Market 合约控制拆分与赎回。
 */
contract EstateNFT is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    // tokenId => 是否已被拆分
    mapping(uint256 => bool) public isFractionalized;

    // Market 合约地址，拥有拆分/赎回操作权限
    address public market;

    event PropertyMinted(uint256 indexed tokenId, address indexed owner, string tokenURI);
    event Fractionalized(uint256 indexed tokenId);
    event Redeemed(uint256 indexed tokenId);

    modifier onlyMarket() {
        require(msg.sender == market, 'EstateNFT: caller is not market');
        _;
    }

    constructor() ERC721('EstateNFT', 'ESTNFT') Ownable(msg.sender) {}

    function setMarket(address _market) external onlyOwner {
        require(_market != address(0), 'EstateNFT: zero address');
        market = _market;
    }

    /**
     * @dev 铸造房产主 NFT
     * @param to 房产所有者地址
     * @param tokenURI 房产元数据链接（建议为 IPFS 链接）
     */
    function mintProperty(address to, string memory tokenURI) external returns (uint256) {
        require(to != address(0), 'EstateNFT: zero address');
        uint256 tokenId = _nextTokenId;
        _nextTokenId++;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, tokenURI);

        emit PropertyMinted(tokenId, to, tokenURI);
        return tokenId;
    }

    /**
     * @dev Market 调用：标记房产已被拆分
     */
    function markFractionalized(uint256 tokenId) external onlyMarket {
        require(_ownerOf(tokenId) != address(0), 'EstateNFT: token not exist');
        require(!isFractionalized[tokenId], 'EstateNFT: already fractionalized');
        isFractionalized[tokenId] = true;
        emit Fractionalized(tokenId);
    }

    /**
     * @dev Market 调用：标记房产已赎回合并
     */
    function markRedeemed(uint256 tokenId) external onlyMarket {
        require(isFractionalized[tokenId], 'EstateNFT: not fractionalized');
        isFractionalized[tokenId] = false;
        emit Redeemed(tokenId);
    }

    function totalSupply() external view returns (uint256) {
        return _nextTokenId;
    }
}
