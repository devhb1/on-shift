// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "../interfaces/IPermissionedRegistry.sol";
import {RegistryRoles} from "./Roles.sol";

/// @title PermissionedRegistry (local ENSv2-semantics implementation)
/// @notice A compact, self-contained registry that reproduces the ENSv2 behaviours OnShift is designed
///         around, so the whole system can be exercised on a local chain and in unit tests:
///         - names keyed by labelhash; token ID = labelId with a 32-bit version in the low bits
///         - re-registration bumps the version, so grants made to an old token are void
///         - expiry needs no transaction: ownerOf/getResolver/getSubregistry return 0 once expired
///         - getState().latestOwner ignores expiry (consumers MUST check expiry themselves)
///         - transfers need ROLE_CAN_TRANSFER_ADMIN on the token; ERC1155 operators inherit the
///           owner's roles (so registering with roleBitmap = 0 leaves nothing to inherit)
///         - renew() revives the previous owner AND roles (the trap OnShift's policy forbids)
/// @dev On Sepolia, OnShift points at the real ENSv2 UserRegistry instead (see docs/ENSV2_MAPPING.md).
contract PermissionedRegistry is IPermissionedRegistry {
    struct Entry {
        address owner;
        uint64 expiry;
        uint32 version;
        IPermissionedRegistry subregistry;
        address resolver;
    }

    mapping(uint256 labelId => Entry) internal _entries;
    mapping(uint256 labelId => string) public labelOf;
    /// @dev Name roles are keyed by the full token ID, so a version bump invalidates them.
    mapping(uint256 tokenId => mapping(address account => uint256)) internal _nameRoles;
    mapping(address account => uint256) public rootRoles;
    mapping(address owner => mapping(address operator => bool)) public isApprovedForAll;

    event NameRegistered(uint256 indexed tokenId, string label, address indexed owner, uint64 expiry);
    event NameUnregistered(uint256 indexed labelId, address indexed by);
    event NameRenewed(uint256 indexed tokenId, uint64 newExpiry, address indexed by);
    event SubregistryUpdated(uint256 indexed labelId, address subregistry);
    event ResolverUpdated(uint256 indexed labelId, address resolver);
    event RootRolesChanged(address indexed account, uint256 roles);
    event TransferSingle(
        address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value
    );
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    error Unauthorized(uint256 role, address account);
    error NameAlreadyRegistered(string label);
    error NameNotRegistered(uint256 labelId);
    error InvalidExpiry(uint64 expiry);
    error TransferDisallowed(uint256 tokenId, address from);
    error NotTokenOwner(uint256 tokenId, address account);

    constructor(address admin) {
        if (admin != address(0)) {
            rootRoles[admin] = type(uint256).max;
            emit RootRolesChanged(admin, type(uint256).max);
        }
    }

    // ---------------------------------------------------------------- access control

    modifier onlyRoot(uint256 role) {
        if (rootRoles[msg.sender] & role == 0) revert Unauthorized(role, msg.sender);
        _;
    }

    function hasRootRoles(uint256 roleBitmap, address account) public view returns (bool) {
        return rootRoles[account] & roleBitmap == roleBitmap;
    }

    function grantRootRoles(uint256 roleBitmap, address account) external onlyRoot(RegistryRoles.ROLE_ADMIN) {
        rootRoles[account] |= roleBitmap;
        emit RootRolesChanged(account, rootRoles[account]);
    }

    function revokeRootRoles(uint256 roleBitmap, address account)
        external
        onlyRoot(RegistryRoles.ROLE_ADMIN)
    {
        rootRoles[account] &= ~roleBitmap;
        emit RootRolesChanged(account, rootRoles[account]);
    }

    /// @notice Roles `account` effectively holds on a live token: its own, or the owner's if approved.
    function roles(uint256 tokenId, address account) public view returns (uint256) {
        address owner = ownerOf(tokenId);
        if (owner == address(0)) return 0;
        if (account == owner || isApprovedForAll[owner][account]) return _nameRoles[tokenId][owner];
        return _nameRoles[tokenId][account];
    }

    function _checkNameOrRoot(uint256 labelId, uint256 role) internal view {
        if (rootRoles[msg.sender] & role != 0) return;
        if (roles(_tokenId(labelId), msg.sender) & role != 0) return;
        revert Unauthorized(role, msg.sender);
    }

    // ---------------------------------------------------------------- registration lifecycle

    function register(
        string calldata label,
        address owner,
        IPermissionedRegistry subregistry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external onlyRoot(RegistryRoles.ROLE_REGISTRAR) returns (uint256 tokenId) {
        uint256 id = _labelId(uint256(keccak256(bytes(label))));
        Entry storage e = _entries[id];
        if (_isLive(e)) revert NameAlreadyRegistered(label);
        if (expiry <= block.timestamp) revert InvalidExpiry(expiry);

        e.version += 1;
        e.owner = owner;
        e.expiry = expiry;
        e.subregistry = subregistry;
        e.resolver = resolver;
        labelOf[id] = label;

        tokenId = id | e.version;
        _nameRoles[tokenId][owner] = roleBitmap;

        emit NameRegistered(tokenId, label, owner, expiry);
        emit TransferSingle(msg.sender, address(0), owner, tokenId, 1);
    }

    /// @notice Ends a registration early. The entry keeps its latestOwner, like an expiry would.
    function unregister(uint256 anyId) external onlyRoot(RegistryRoles.ROLE_UNREGISTER) {
        uint256 id = _labelId(anyId);
        Entry storage e = _entries[id];
        if (!_isLive(e)) revert NameNotRegistered(id);
        e.expiry = uint64(block.timestamp);
        emit NameUnregistered(id, msg.sender);
    }

    /// @notice Extends (or REVIVES) a registration with its previous owner, token and roles.
    function renew(uint256 anyId, uint64 newExpiry) external {
        uint256 id = _labelId(anyId);
        Entry storage e = _entries[id];
        if (e.owner == address(0)) revert NameNotRegistered(id);
        if (rootRoles[msg.sender] & RegistryRoles.ROLE_RENEW == 0) {
            revert Unauthorized(RegistryRoles.ROLE_RENEW, msg.sender);
        }
        if (newExpiry <= e.expiry || newExpiry <= block.timestamp) revert InvalidExpiry(newExpiry);
        e.expiry = newExpiry;
        emit NameRenewed(id | e.version, newExpiry, msg.sender);
    }

    function setSubregistry(uint256 anyId, IPermissionedRegistry registry) external {
        uint256 id = _labelId(anyId);
        _checkNameOrRoot(id, RegistryRoles.ROLE_SET_SUBREGISTRY);
        _entries[id].subregistry = registry;
        emit SubregistryUpdated(id, address(registry));
    }

    function setResolver(uint256 anyId, address resolver) external {
        uint256 id = _labelId(anyId);
        _checkNameOrRoot(id, RegistryRoles.ROLE_SET_RESOLVER);
        _entries[id].resolver = resolver;
        emit ResolverUpdated(id, resolver);
    }

    // ---------------------------------------------------------------- views

    function getState(uint256 anyId) external view returns (State memory s) {
        uint256 id = _labelId(anyId);
        Entry storage e = _entries[id];
        s.status = _isLive(e) ? Status.REGISTERED : Status.AVAILABLE;
        s.expiry = e.expiry;
        s.latestOwner = e.owner;
        s.tokenId = id | e.version;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        uint256 id = _labelId(tokenId);
        Entry storage e = _entries[id];
        if (!_isLive(e) || tokenId != (id | e.version)) return address(0);
        return e.owner;
    }

    function getSubregistry(string calldata label) external view returns (IPermissionedRegistry) {
        Entry storage e = _entries[_labelId(uint256(keccak256(bytes(label))))];
        return _isLive(e) ? e.subregistry : IPermissionedRegistry(address(0));
    }

    function getResolver(string calldata label) external view returns (address) {
        Entry storage e = _entries[_labelId(uint256(keccak256(bytes(label))))];
        return _isLive(e) ? e.resolver : address(0);
    }

    // ---------------------------------------------------------------- minimal ERC1155 surface

    function balanceOf(address account, uint256 tokenId) external view returns (uint256) {
        return ownerOf(tokenId) == account && account != address(0) ? 1 : 0;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, uint256 amount, bytes calldata)
        external
    {
        if (amount != 1 || ownerOf(tokenId) != from) revert NotTokenOwner(tokenId, from);
        if (msg.sender != from && !isApprovedForAll[from][msg.sender]) {
            revert NotTokenOwner(tokenId, msg.sender);
        }
        uint256 held = _nameRoles[tokenId][from];
        if (held & RegistryRoles.ROLE_CAN_TRANSFER_ADMIN == 0) revert TransferDisallowed(tokenId, from);

        _entries[_labelId(tokenId)].owner = to;
        delete _nameRoles[tokenId][from];
        _nameRoles[tokenId][to] = held;
        emit TransferSingle(msg.sender, from, to, tokenId, 1);
    }

    // ---------------------------------------------------------------- internals

    function _labelId(uint256 anyId) internal pure returns (uint256) {
        return anyId & ~uint256(0xffffffff);
    }

    function _tokenId(uint256 labelId) internal view returns (uint256) {
        return labelId | _entries[labelId].version;
    }

    function _isLive(Entry storage e) internal view returns (bool) {
        return e.owner != address(0) && block.timestamp < e.expiry;
    }
}
