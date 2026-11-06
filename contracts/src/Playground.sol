// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PassIssuer} from "./PassIssuer.sol";

/// @title Playground
/// @notice Public faucet for *demo* passes under demo.<org>. Never writes into ops.<org>, never
///         carries real staff role names, and never shares the production till's float or orders.
///
///         Labels are play-<8hex> from keccak(requester, count). Caps stay at $5 / 1 hour / 3 tries
///         per day. Agent context is forced empty by PassIssuer.issueDemo.
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

    /// @notice Issue a sandbox pass to `holder`. Any ETH sent is forwarded as the holder's gas.
    /// @param demoPresetId 0 = Demo cashier, 1 = Demo agent (see PassIssuer demo presets).
    function tryIt(address holder, uint8 demoPresetId, uint64 duration, uint256 cap)
        external
        payable
        returns (string memory label)
    {
        if (cap > MAX_CAP) revert CapTooHigh();
        if (duration > MAX_DURATION) revert DurationTooLong();
        uint256 day = block.timestamp / 1 days;
        if (triesOnDay[msg.sender][day] >= MAX_PER_DAY) revert TooManyToday();
        triesOnDay[msg.sender][day] += 1;

        uint256 n = ++count;
        label = string.concat("play-", _hex8(uint32(uint256(keccak256(abi.encode(msg.sender, n))))));
        requesterOf[keccak256(bytes(label))] = msg.sender;
        ISSUER.issueDemo{value: msg.value}(label, holder, demoPresetId, duration, cap);
        emit Tried(label, msg.sender, holder, demoPresetId, duration, cap);
    }

    /// @notice End a playground pass early. Only the wallet that asked for it can.
    function revoke(string calldata label) external {
        if (requesterOf[keccak256(bytes(label))] != msg.sender) revert NotRequester();
        ISSUER.revokeNow(label);
    }

    function _hex8(uint32 v) internal pure returns (string memory) {
        bytes16 alphabet = "0123456789abcdef";
        bytes memory out = new bytes(8);
        unchecked {
            for (uint256 i; i < 8; ++i) {
                out[7 - i] = alphabet[v & 0xf];
                v >>= 4;
            }
        }
        return string(out);
    }
}
