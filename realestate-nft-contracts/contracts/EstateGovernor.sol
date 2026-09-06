// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';

interface INFT {
    function totalSupply() external view returns (uint256);
}

interface IFractions {
    function balanceOf(address account, uint256 id) external view returns (uint256);
}

interface IMarket {
    function totalFractions(uint256 tokenId) external view returns (uint256);
}

/**
 * @title EstateGovernor
 * @dev 份额持有人 DAO 治理：投票权重 = 持有的房产份额总数（ERC1155 余额）。
 *      提案为任意目标合约调用（如调整市场参数、转移合约所有权），
 *      经提案阈值、法定人数、投票期、时间锁后执行，实现“股东共治”。
 */
contract EstateGovernor is ReentrancyGuard {
    enum ProposalState { Pending, Active, Canceled, Defeated, Succeeded, Queued, Expired, Executed }
    enum VoteType { Against, For, Abstain }

    struct Proposal {
        address proposer;
        uint64 startAt;      // 投票开始时间
        uint64 endAt;        // 投票截止
        uint64 eta;          // 时间锁可执行时间
        bool canceled;
        bool executed;
        uint256 forVotes;
        uint256 againstVotes;
        uint256 abstainVotes;
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        string description;
    }

    IFractions public immutable fractionToken;
    INFT public immutable estateNFT;
    IMarket public immutable market;

    uint256 public votingDelay;       // 秒
    uint256 public votingPeriod;      // 秒
    uint256 public timelockDelay;     // 秒
    uint256 public proposalThreshold; // 提案所需最小份额
    uint256 public quorumPercent;     // 法定人数百分比（0-100）

    uint256 public proposalCount;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event ProposalCreated(uint256 indexed id, address indexed proposer, string description);
    event VoteCast(uint256 indexed id, address indexed voter, uint8 support, uint256 weight);
    event ProposalQueued(uint256 indexed id, uint256 eta);
    event ProposalExecuted(uint256 indexed id);
    event ProposalCanceled(uint256 indexed id);

    constructor(
        address _fractionToken,
        address _estateNFT,
        address _market,
        uint256 _votingDelay,
        uint256 _votingPeriod,
        uint256 _timelockDelay,
        uint256 _proposalThreshold,
        uint256 _quorumPercent
    ) {
        require(_fractionToken != address(0) && _estateNFT != address(0) && _market != address(0), 'Gov: zero address');
        require(_quorumPercent <= 100, 'Gov: bad quorum');
        fractionToken = IFractions(_fractionToken);
        estateNFT = INFT(_estateNFT);
        market = IMarket(_market);
        votingDelay = _votingDelay;
        votingPeriod = _votingPeriod;
        timelockDelay = _timelockDelay;
        proposalThreshold = _proposalThreshold;
        quorumPercent = _quorumPercent;
    }

    // ==================== 投票权重 ====================

    /// @dev 选民权重 = 其在所有房产上的份额总和
    function getVotes(address voter) public view returns (uint256 total) {
        uint256 n = estateNFT.totalSupply();
        for (uint256 i = 0; i < n; i++) {
            total += fractionToken.balanceOf(voter, i);
        }
    }

    /// @dev 当前全部已拆分份额总量
    function totalVotingSupply() public view returns (uint256 total) {
        uint256 n = estateNFT.totalSupply();
        for (uint256 i = 0; i < n; i++) {
            total += market.totalFractions(i);
        }
    }

    function quorum() public view returns (uint256) {
        return (totalVotingSupply() * quorumPercent) / 100;
    }

    // ==================== 提案 ====================

    function propose(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description
    ) external nonReentrant returns (uint256 id) {
        require(targets.length == values.length && targets.length == calldatas.length && targets.length > 0, 'Gov: bad proposal');
        require(getVotes(msg.sender) >= proposalThreshold, 'Gov: below threshold');

        id = proposalCount++;
        Proposal storage p = _proposals[id];
        p.proposer = msg.sender;
        p.startAt = uint64(block.timestamp + votingDelay);
        p.endAt = uint64(block.timestamp + votingDelay + votingPeriod);
        for (uint256 i = 0; i < targets.length; i++) {
            p.targets.push(targets[i]);
            p.values.push(values[i]);
            p.calldatas.push(calldatas[i]);
        }
        p.description = description;

        emit ProposalCreated(id, msg.sender, description);
    }

    function castVote(uint256 id, uint8 support) external nonReentrant returns (uint256 weight) {
        require(state(id) == ProposalState.Active, 'Gov: not active');
        require(!hasVoted[id][msg.sender], 'Gov: already voted');
        weight = getVotes(msg.sender);
        require(weight > 0, 'Gov: no voting power');

        hasVoted[id][msg.sender] = true;
        if (support == uint8(VoteType.For)) _proposals[id].forVotes += weight;
        else if (support == uint8(VoteType.Against)) _proposals[id].againstVotes += weight;
        else _proposals[id].abstainVotes += weight;

        emit VoteCast(id, msg.sender, support, weight);
    }

    function queue(uint256 id) external {
        require(state(id) == ProposalState.Succeeded, 'Gov: not succeeded');
        Proposal storage p = _proposals[id];
        p.eta = uint64(block.timestamp + timelockDelay);
        emit ProposalQueued(id, p.eta);
    }

    function execute(uint256 id) external payable nonReentrant {
        require(state(id) == ProposalState.Queued, 'Gov: not queued');
        Proposal storage p = _proposals[id];
        require(block.timestamp >= p.eta, 'Gov: timelock not reached');

        p.executed = true;
        for (uint256 i = 0; i < p.targets.length; i++) {
            (bool ok, bytes memory ret) = p.targets[i].call{value: p.values[i]}(p.calldatas[i]);
            require(ok, string.concat('Gov: call failed: ', _revertMsg(ret)));
        }
        emit ProposalExecuted(id);
    }

    function cancel(uint256 id) external {
        Proposal storage p = _proposals[id];
        require(msg.sender == p.proposer, 'Gov: only proposer');
        require(!p.executed, 'Gov: executed');
        p.canceled = true;
        emit ProposalCanceled(id);
    }

    function state(uint256 id) public view returns (ProposalState) {
        Proposal storage p = _proposals[id];
        if (p.canceled) return ProposalState.Canceled;
        if (p.executed) return ProposalState.Executed;
        if (block.timestamp < p.startAt) return ProposalState.Pending;
        if (block.timestamp <= p.endAt) return ProposalState.Active;
        bool quorumReached = p.forVotes + p.abstainVotes >= quorum();
        bool passed = p.forVotes > p.againstVotes;
        if (!quorumReached || !passed) return ProposalState.Defeated;
        if (p.eta == 0) return ProposalState.Succeeded;
        // 已入队：时间锁到达后可执行，超过宽限期则过期
        if (block.timestamp < p.eta) return ProposalState.Queued;
        if (block.timestamp > p.eta + 7 days) return ProposalState.Expired;
        return ProposalState.Queued;
    }

    function getProposal(uint256 id)
        external
        view
        returns (
            address proposer,
            uint256 startAt,
            uint256 endAt,
            uint256 eta,
            bool executed,
            bool canceled,
            uint256 forVotes,
            uint256 againstVotes,
            uint256 abstainVotes,
            string memory description
        )
    {
        Proposal storage p = _proposals[id];
        return (p.proposer, p.startAt, p.endAt, p.eta, p.executed, p.canceled, p.forVotes, p.againstVotes, p.abstainVotes, p.description);
    }

    function _revertMsg(bytes memory ret) internal pure returns (string memory) {
        if (ret.length < 68) return 'no reason';
        assembly {
            ret := add(ret, 68)
        }
        return abi.decode(ret, (string));
    }

    receive() external payable {}
}
