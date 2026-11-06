// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ENS name helpers: labelhash, namehash steps, and DNS wire-format encoding.
library NameHash {
    error InvalidName();

    /// @notice node(child) = keccak256(parentNode, labelhash(label)).
    function child(bytes32 parentNode, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
    }

    function labelId(string memory label) internal pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }

    /// @notice Prepend one label to a DNS-encoded name: ("shift-1", "\x03ops...") => "\x07shift-1\x03ops...".
    function prepend(string memory label, bytes memory dnsParent) internal pure returns (bytes memory) {
        uint256 n = bytes(label).length;
        if (n == 0 || n > 255) revert InvalidName();
        return abi.encodePacked(uint8(n), label, dnsParent);
    }

    /// @notice DNS-encode a dotted name, e.g. "ops.onshift.eth".
    function dnsEncode(string memory name) internal pure returns (bytes memory out) {
        bytes memory b = bytes(name);
        uint256 start;
        for (uint256 i; i <= b.length; ++i) {
            if (i == b.length || b[i] == ".") {
                uint256 len = i - start;
                if (len == 0 || len > 255) revert InvalidName();
                bytes memory label = new bytes(len);
                for (uint256 j; j < len; ++j) {
                    label[j] = b[start + j];
                }
                out = abi.encodePacked(out, uint8(len), label);
                start = i + 1;
            }
        }
        out = abi.encodePacked(out, uint8(0));
    }

    /// @notice Namehash of a DNS-encoded name.
    function namehash(bytes memory dns) internal pure returns (bytes32 node) {
        // collect label offsets, then hash from the right
        uint256[] memory offsets = new uint256[](dns.length);
        uint256 count;
        uint256 i;
        while (i < dns.length && dns[i] != 0) {
            offsets[count++] = i;
            i += uint8(dns[i]) + 1;
        }
        if (i >= dns.length) revert InvalidName();
        for (uint256 k = count; k > 0; --k) {
            uint256 o = offsets[k - 1];
            uint256 len = uint8(dns[o]);
            bytes32 lh;
            assembly ("memory-safe") {
                lh := keccak256(add(add(dns, 0x21), o), len)
            }
            node = keccak256(abi.encodePacked(node, lh));
        }
    }
}
