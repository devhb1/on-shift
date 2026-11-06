// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ENSv2 VerifiableFactory: deterministic, verifiable proxies initialised in the same transaction.
interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}
