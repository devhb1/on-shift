// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library NameHash {
    /// @notice ENS namehash step: node(child) = keccak256(parentNode, labelhash(label)).
    function child(bytes32 parentNode, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }

    function labelId(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }
}
