// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title MockV3Aggregator
 * @dev 本地/测试网模拟 Chainlink AggregatorV3 价格馈送。
 *      Polygon Amoy 上替换为真实 ETH/USD 馈送地址即可。
 */
contract MockV3Aggregator {
    uint8 public decimals;
    int256 private _answer;
    uint256 private _updatedAt;
    uint80 private _roundId;

    event AnswerUpdated(int256 indexed current, uint256 roundId, uint256 timestamp);

    constructor(uint8 _decimals, int256 _initialAnswer) {
        decimals = _decimals;
        _answer = _initialAnswer;
        _updatedAt = block.timestamp;
    }

    function setAnswer(int256 newAnswer) external {
        _answer = newAnswer;
        _updatedAt = block.timestamp;
        _roundId++;
        emit AnswerUpdated(newAnswer, _roundId, block.timestamp);
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }

    function getRoundData(uint80)
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }
}
