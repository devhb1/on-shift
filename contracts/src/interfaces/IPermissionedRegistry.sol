// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ABI-compatible subset of ensdomains/contracts-v2 IPermissionedRegistry (+ IStandardRegistry,
///         IRegistry, IEnhancedAccessControl). Semantics OnShift relies on:
///         - look-ups keyed by labelhash ("anyId"); token IDs are mutable (low 32 bits = version)
///         - getState().latestOwner IGNORES expiry, so consumers must check expiry themselves
///         - once expired, getResolver / getSubregistry / ownerOf return 0 with no transaction
///         - renew() on an expired name revives the previous owner, token and roles
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
        uint256 resource;
    }

    function register(
        string calldata label,
        address owner,
        IPermissionedRegistry registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);

    function unregister(uint256 anyId) external;

    function renew(uint256 anyId, uint64 newExpiry) external;

    function setSubregistry(uint256 anyId, IPermissionedRegistry registry) external;

    function setResolver(uint256 anyId, address resolver) external;

    function setParent(IPermissionedRegistry parent, string calldata label) external;

    function getState(uint256 anyId) external view returns (State memory);

    function getSubregistry(string calldata label) external view returns (IPermissionedRegistry);

    function getResolver(string calldata label) external view returns (address);

    function ownerOf(uint256 tokenId) external view returns (address);

    function hasRoles(uint256 resource, uint256 roleBitmap, address account) external view returns (bool);

    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool);

    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
}

/// @notice ensdomains/contracts-v2 UserRegistry initialiser (deployed as a proxy by the VerifiableFactory).
interface IUserRegistryInit {
    function initialize(address rootAccount, uint256 roleBitmap) external;
}
