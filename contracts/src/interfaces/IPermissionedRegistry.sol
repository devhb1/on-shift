// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The subset of the ENSv2 IPermissionedRegistry surface that OnShift depends on.
/// @dev Names and semantics follow docs.ens.domains/ensv2/permissioned-registry:
///      - every look-up is keyed by labelhash ("anyId"); token IDs are mutable (low 32 bits = version)
///      - getState() reports status/expiry/latestOwner; latestOwner IGNORES expiry
///      - on expiry ownerOf / getResolver / getSubregistry return address(0)
///      - renew() on an expired name revives the previous owner, token and roles
interface IPermissionedRegistry {
    enum Status {
        AVAILABLE,
        RESERVED,
        REGISTERED
    }

    struct State {
        Status status;
        uint64 expiry;
        address latestOwner;
        uint256 tokenId;
    }

    function register(
        string calldata label,
        address owner,
        IPermissionedRegistry subregistry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);

    function unregister(uint256 anyId) external;

    function renew(uint256 anyId, uint64 newExpiry) external;

    function getState(uint256 anyId) external view returns (State memory);

    function getSubregistry(string calldata label) external view returns (IPermissionedRegistry);

    function getResolver(string calldata label) external view returns (address);

    function setSubregistry(uint256 anyId, IPermissionedRegistry registry) external;

    function setResolver(uint256 anyId, address resolver) external;

    function ownerOf(uint256 tokenId) external view returns (address);

    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);

    function grantRootRoles(uint256 roleBitmap, address account) external;
}
