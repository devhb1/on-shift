// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IVerifiableFactory} from "../interfaces/IVerifiableFactory.sol";

/// @title VerifiableFactory (local)
/// @notice Same `deployProxy(implementation, salt, data)` ABI as the ENSv2 VerifiableFactory. Locally it
///         deploys EIP-1167 clones via CREATE2 and runs `data` (the initialiser) in the same transaction.
///         The salt is bound to the caller so nobody can squat another deployer's address.
contract VerifiableFactory is IVerifiableFactory {
    event ProxyDeployed(
        address indexed sender, address indexed proxyAddress, uint256 salt, address implementation
    );

    error DeployFailed();
    error InitFailed(bytes reason);

    function deployProxy(address implementation, uint256 salt, bytes calldata data)
        external
        returns (address proxy)
    {
        bytes32 boundSalt = keccak256(abi.encode(msg.sender, salt));
        assembly ("memory-safe") {
            mstore(
                0x00,
                or(shr(0xe8, shl(0x60, implementation)), 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000)
            )
            mstore(0x20, or(shl(0x78, implementation), 0x5af43d82803e903d91602b57fd5bf3))
            proxy := create2(0, 0x09, 0x37, boundSalt)
        }
        if (proxy == address(0)) revert DeployFailed();
        if (data.length > 0) {
            (bool ok, bytes memory reason) = proxy.call(data);
            if (!ok) revert InitFailed(reason);
        }
        emit ProxyDeployed(msg.sender, proxy, salt, implementation);
    }
}
