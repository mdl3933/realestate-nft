// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

/**
 * @title MockUSDC
 * @dev 测试用美元稳定币（6 位小数，与真实 USDC 一致），任何人可铸造用于演示。
 *      Polygon Amoy 上可直接使用 Circle 官方测试 USDC，无需部署本合约。
 */
contract MockUSDC is ERC20 {
    constructor() ERC20('USD Coin (Mock)', 'USDC') {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @dev 测试水龙头：任意地址可领取 10,000 USDC
    function faucet() external {
        _mint(msg.sender, 10_000 * 1e6);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
