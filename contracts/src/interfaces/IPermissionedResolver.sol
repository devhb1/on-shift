// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ABI-compatible subset of ensdomains/contracts-v2 PermissionedResolver.
/// @dev Roles live on EAC resources: resource(0,0) = any name/any key, resource(node,0) = one name,
///      resource(node, keyHash) = one record of one name. authorizeTextRoles() grants the narrowest.
interface IPermissionedResolver {
    function initialize(address admin, uint256 roleBitmap, bytes[] calldata setters) external;

    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);

    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool);

    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);

    /// @notice Grant/revoke ROLE_SET_TEXT for record `key` of DNS-encoded `toName` only.
    function authorizeTextRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external
        returns (bool);

    function grantRoles(uint256 resource, uint256 roleBitmap, address account) external returns (bool);

    function resource(bytes32 node, bytes32 part) external pure returns (uint256);

    /// @notice Resolver-level alias: `fromName` serves `toName`'s records. Empty `toName` clears it.
    function setAlias(bytes calldata fromName, bytes calldata toName) external;

    function getAlias(bytes calldata name) external view returns (bytes memory);

    function setAddr(bytes32 node, uint256 coinType, bytes calldata value) external;

    function setText(bytes32 node, string calldata key, string calldata value) external;

    function setData(bytes32 node, string calldata key, bytes calldata value) external;

    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory);

    function text(bytes32 node, string calldata key) external view returns (string memory);

    function data(bytes32 node, string calldata key) external view returns (bytes memory);
}
