// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PassIssuer} from "./PassIssuer.sol";

/// @title Playground
/// @notice A public shift lead with tight limits, so anyone with a wallet can issue a real pass on the
///         live deployment. The org registers this contract as a lead; PassIssuer enforces every normal
///         rule on top (presets, the lead's daily budget, the live namespace, roleBitmap = 0).
///
///         Playground passes are named play-<n>, last at most an hour and carry at most $5 of refund
///         authority. Refunds are bound to paid orders in ShiftGate, so a playground pass cannot pull
///         money out of the gate that nobody paid in.
contract Playground {
    uint256 public constant MAX_CAP = 5e6;
    uint64 public constant MAX_DURATION = 1 hours;
    uint8 public constant MAX_PER_DAY = 3;

    PassIssuer public immutable ISSUER;

    uint256 public count;
    mapping(address requester => mapping(uint256 day => uint8)) public triesOnDay;
    mapping(bytes32 labelhash => address) public requesterOf;

    event Tried(
        string label, address indexed requester, address indexed holder, uint8 presetId, uint64 duration, uint256 cap
    );

    error CapTooHigh();
    error DurationTooLong();
    error TooManyToday();
    error NotRequester();

    constructor(PassIssuer issuer) {
        ISSUER = issuer;
    }

    /// @notice Issue a playground pass to `holder`. Any ETH sent is forwarded as the holder's gas.
    function tryIt(address holder, uint8 presetId, uint64 duration, uint256 cap, string calldata agentContext)
        external
        payable
        returns (string memory label)
    {
        if (cap > MAX_CAP) revert CapTooHigh();
        if (duration > MAX_DURATION) revert DurationTooLong();
        uint256 day = block.timestamp / 1 days;
        if (triesOnDay[msg.sender][day] >= MAX_PER_DAY) revert TooManyToday();
        triesOnDay[msg.sender][day] += 1;

        label = string.concat("play-", _toString(++count));
        requesterOf[keccak256(bytes(label))] = msg.sender;
        ISSUER.issue{value: msg.value}(label, holder, presetId, duration, cap, agentContext);
        emit Tried(label, msg.sender, holder, presetId, duration, cap);
    }

    /// @notice End a playground pass early. Only the wallet that asked for it can.
    function revoke(string calldata label) external {
        if (requesterOf[keccak256(bytes(label))] != msg.sender) revert NotRequester();
        ISSUER.revokeNow(label);
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 len;
        for (uint256 x = v; x != 0; x /= 10) ++len;
        bytes memory b = new bytes(len);
        for (; v != 0; v /= 10) b[--len] = bytes1(uint8(48 + v % 10));
        return string(b);
    }
}
