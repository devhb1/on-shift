// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ResolverFactory
/// @notice Local stand-in for the ENSv2 Verifiable Factory: deterministic EIP-1167 proxies, initialised
///         in the same transaction. The salt is bound to the caller so nobody can squat a pass address.
contract ResolverFactory {
    event ProxyDeployed(
        address indexed deployer, address indexed implementation, address proxy, bytes32 salt
    );

    error DeployFailed();
    error InitFailed(bytes reason);

    function deployProxy(address implementation, bytes32 salt, bytes calldata initData)
        external
        returns (address proxy)
    {
        bytes32 boundSalt = keccak256(abi.encode(msg.sender, salt));
        proxy = _clone(implementation, boundSalt);
        (bool ok, bytes memory reason) = proxy.call(initData);
        if (!ok) revert InitFailed(reason);
        emit ProxyDeployed(msg.sender, implementation, proxy, salt);
    }

    function predict(address deployer, address implementation, bytes32 salt) external view returns (address) {
        bytes32 boundSalt = keccak256(abi.encode(deployer, salt));
        bytes32 codeHash = keccak256(
            abi.encodePacked(
                hex"3d602d80600a3d3981f3363d3d373d3d3d363d73",
                implementation,
                hex"5af43d82803e903d91602b57fd5bf3"
            )
        );
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), boundSalt, codeHash))))
        );
    }

    /// @dev EIP-1167 minimal proxy via CREATE2 (same bytecode layout as OpenZeppelin Clones).
    function _clone(address implementation, bytes32 salt) internal returns (address instance) {
        assembly ("memory-safe") {
            mstore(
                0x00,
                or(shr(0xe8, shl(0x60, implementation)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000)
            )
            mstore(0x20, or(shl(0x78, implementation), 0x5af43d82803e903d91602b57fd5bf3))
            instance := create2(0, 0x09, 0x37, salt)
        }
        if (instance == address(0)) revert DeployFailed();
    }
}
