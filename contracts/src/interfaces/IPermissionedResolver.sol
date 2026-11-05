// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The subset of the ENSv2 Permissioned Resolver surface that OnShift depends on.
/// @dev Important property (docs: "no per-name scoping"): a role held on a resolver instance covers
///      EVERY name that instance serves. Setter roles can be scoped to a record KEY, never to a name.
///      OnShift therefore deploys one resolver instance per pass.
interface IPermissionedResolver {
    function initialize(address admin) external;

    function grantRoles(uint256 roleBitmap, address account) external;

    function revokeRoles(uint256 roleBitmap, address account) external;

    /// @notice Key-scoped setter: `account` may write text record `key` on any node of this resolver.
    function grantTextSetter(string calldata key, address account) external;

    function setAddr(bytes32 node, uint256 coinType, bytes calldata value) external;

    function setText(bytes32 node, string calldata key, string calldata value) external;

    function setData(bytes32 node, string calldata key, bytes calldata value) external;

    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory);

    function text(bytes32 node, string calldata key) external view returns (string memory);

    function data(bytes32 node, string calldata key) external view returns (bytes memory);
}
