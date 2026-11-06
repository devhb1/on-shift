// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "../interfaces/IPermissionedRegistry.sol";
import {RegistryRoles} from "./Roles.sol";

/// @title PermissionedRegistry (local, ABI-compatible with ensdomains/contracts-v2 UserRegistry)
/// @notice A compact re-implementation of the ENSv2 registry behaviours OnShift depends on, so the whole
///         system runs on Anvil and in unit tests. The same OnShift contracts run unchanged on the real
///         ENSv2 deployment on Sepolia (see test/SepoliaFork.t.sol and script/DeploySepolia.s.sol).
///
///         Mirrored semantics:
///         - token ID and EAC resource = labelId with a 32-bit version in the low bits
///         - an expired entry's resource is "the next version", so name-level roles go inert at expiry
///           and come back if the name is renewed (revived)
///         - unregister() burns the token and bumps both versions
///         - getState().latestOwner ignores expiry; ownerOf / getResolver / getSubregistry do not
///         - transfers need ROLE_CAN_TRANSFER_ADMIN; approved operators inherit the owner's roles
///         - root roles apply to every resource; admin bits (role << 128) gate granting
contract PermissionedRegistry is IPermissionedRegistry {
    uint256 public constant ROOT_RESOURCE = 0;

    struct Entry {
        uint32 eacVersionId;
        uint32 tokenVersionId;
        uint64 expiry;
        address owner; // ERC1155 owner of the current token (0 after burn)
        IPermissionedRegistry subregistry;
        address resolver;
    }

    bool private _initialized;
    mapping(uint256 labelId => Entry) internal _entries;
    mapping(uint256 resource => mapping(address account => uint256)) internal _roles;
    mapping(address owner => mapping(address operator => bool)) public isApprovedForAll;
    IPermissionedRegistry public parentRegistry;
    string public childLabel;

    event LabelRegistered(uint256 indexed tokenId, string label, address indexed owner, uint64 expiry);
    event LabelUnregistered(uint256 indexed tokenId, address indexed sender);
    event ExpiryUpdated(uint256 indexed tokenId, uint64 newExpiry, address indexed sender);
    event SubregistryUpdated(uint256 indexed tokenId, address subregistry, address indexed sender);
    event ResolverUpdated(uint256 indexed tokenId, address resolver, address indexed sender);
    event EACRolesChanged(
        uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap
    );
    event TransferSingle(
        address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value
    );
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);
    error LabelAlreadyRegistered(string label);
    error LabelExpired(uint256 tokenId);
    error CannotSetPastExpiry(uint64 expiry);
    error CannotReduceExpiry(uint64 oldExpiry, uint64 newExpiry);
    error TransferDisallowed(uint256 tokenId, address from);
    error ERC1155MissingApprovalForAll(address operator, address owner);
    error InvalidOwner();
    error AlreadyInitialized();

    /// @dev Lock the implementation; instances are proxies initialised through {initialize}.
    constructor() {
        _initialized = true;
    }

    function initialize(address rootAccount, uint256 roleBitmap) external {
        if (_initialized) revert AlreadyInitialized();
        if (rootAccount == address(0)) revert InvalidOwner();
        _initialized = true;
        _grant(ROOT_RESOURCE, roleBitmap, rootAccount);
    }

    // ---------------------------------------------------------------- access control

    function roles(uint256 anyId, address account) public view returns (uint256) {
        uint256 resource = anyId == ROOT_RESOURCE ? ROOT_RESOURCE : _resource(anyId);
        uint256 r = _roles[resource][account];
        if (resource != ROOT_RESOURCE) {
            Entry storage e = _entry(anyId);
            address owner = _isExpired(e.expiry) ? address(0) : e.owner;
            if (owner != address(0) && owner != account && isApprovedForAll[owner][account]) {
                r |= _roles[resource][owner];
            }
        }
        return r;
    }

    function hasRoles(uint256 resource, uint256 roleBitmap, address account) public view returns (bool) {
        return (_roles[ROOT_RESOURCE][account] | roles(resource, account)) & roleBitmap == roleBitmap;
    }

    function hasRootRoles(uint256 roleBitmap, address account) public view returns (bool) {
        return _roles[ROOT_RESOURCE][account] & roleBitmap == roleBitmap;
    }

    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool) {
        _checkCanGrant(ROOT_RESOURCE, roleBitmap);
        _grant(ROOT_RESOURCE, roleBitmap, account);
        return true;
    }

    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool) {
        _checkCanGrant(ROOT_RESOURCE, roleBitmap);
        uint256 old = _roles[ROOT_RESOURCE][account];
        _roles[ROOT_RESOURCE][account] = old & ~roleBitmap;
        emit EACRolesChanged(ROOT_RESOURCE, account, old, old & ~roleBitmap);
        return true;
    }

    function _checkCanGrant(uint256 resource, uint256 roleBitmap) internal view {
        uint256 held = _roles[ROOT_RESOURCE][msg.sender] | _roles[resource][msg.sender];
        uint256 adminBits = held >> 128;
        uint256 settable = adminBits | (adminBits << 128);
        if (roleBitmap & ~settable != 0) revert EACCannotGrantRoles(resource, roleBitmap, msg.sender);
    }

    function _checkRoles(uint256 resource, uint256 roleBitmap) internal view {
        if (!hasRoles(resource, roleBitmap, msg.sender)) {
            revert EACUnauthorizedAccountRoles(resource, roleBitmap, msg.sender);
        }
    }

    function _grant(uint256 resource, uint256 roleBitmap, address account) internal {
        uint256 old = _roles[resource][account];
        _roles[resource][account] = old | roleBitmap;
        emit EACRolesChanged(resource, account, old, old | roleBitmap);
    }

    // ---------------------------------------------------------------- lifecycle

    function register(
        string calldata label,
        address owner,
        IPermissionedRegistry registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId) {
        if (owner == address(0)) revert InvalidOwner();
        uint256 id = _labelId(uint256(keccak256(bytes(label))));
        Entry storage e = _entries[id];
        if (!_isExpired(e.expiry)) revert LabelAlreadyRegistered(label);
        _checkRoles(ROOT_RESOURCE, RegistryRoles.ROLE_REGISTRAR);
        if (_isExpired(expiry)) revert CannotSetPastExpiry(expiry);

        if (e.owner != address(0)) {
            // burn the expired token: grants on the old resource can never come back
            emit TransferSingle(msg.sender, e.owner, address(0), _tokenId(id, e), 1);
            ++e.eacVersionId;
            ++e.tokenVersionId;
        }
        e.owner = owner;
        e.expiry = expiry;
        e.subregistry = registry;
        e.resolver = resolver;

        tokenId = _tokenId(id, e);
        emit LabelRegistered(tokenId, label, owner, expiry);
        emit TransferSingle(msg.sender, address(0), owner, tokenId, 1);
        if (roleBitmap != 0) _grant(_resource(id), roleBitmap, owner);
    }

    function unregister(uint256 anyId) external {
        (uint256 tokenId, Entry storage e) = _checkExpiryAndTokenRoles(anyId, RegistryRoles.ROLE_UNREGISTER);
        emit LabelUnregistered(tokenId, msg.sender);
        if (e.owner != address(0)) {
            emit TransferSingle(msg.sender, e.owner, address(0), tokenId, 1);
            e.owner = address(0);
            ++e.eacVersionId;
            ++e.tokenVersionId;
        }
        e.expiry = uint64(block.timestamp);
    }

    /// @notice Extends, or for an expired name REVIVES (root ROLE_RENEW), keeping owner and roles.
    function renew(uint256 anyId, uint64 newExpiry) external {
        Entry storage e = _entry(anyId);
        uint256 tokenId = _tokenId(_labelId(anyId), e);
        if (_isExpired(e.expiry)) {
            if (e.expiry == 0 || !hasRootRoles(RegistryRoles.ROLE_RENEW, msg.sender)) {
                revert LabelExpired(tokenId);
            }
        } else {
            _checkRoles(_resource(anyId), RegistryRoles.ROLE_RENEW);
        }
        if (newExpiry < e.expiry) revert CannotReduceExpiry(e.expiry, newExpiry);
        e.expiry = newExpiry;
        emit ExpiryUpdated(tokenId, newExpiry, msg.sender);
    }

    function setSubregistry(uint256 anyId, IPermissionedRegistry registry) external {
        (uint256 tokenId, Entry storage e) =
            _checkExpiryAndTokenRoles(anyId, RegistryRoles.ROLE_SET_SUBREGISTRY);
        e.subregistry = registry;
        emit SubregistryUpdated(tokenId, address(registry), msg.sender);
    }

    function setResolver(uint256 anyId, address resolver) external {
        (uint256 tokenId, Entry storage e) = _checkExpiryAndTokenRoles(anyId, RegistryRoles.ROLE_SET_RESOLVER);
        e.resolver = resolver;
        emit ResolverUpdated(tokenId, resolver, msg.sender);
    }

    function setParent(IPermissionedRegistry parent, string calldata label) external {
        _checkRoles(ROOT_RESOURCE, RegistryRoles.ROLE_SET_PARENT);
        parentRegistry = parent;
        childLabel = label;
    }

    // ---------------------------------------------------------------- views

    function getState(uint256 anyId) external view returns (State memory s) {
        Entry storage e = _entry(anyId);
        s.expiry = e.expiry;
        s.tokenId = _tokenId(_labelId(anyId), e);
        s.resource = _resource(anyId);
        s.latestOwner = e.owner;
        s.status = _isExpired(e.expiry)
            ? Status.AVAILABLE
            : e.owner == address(0) ? Status.RESERVED : Status.REGISTERED;
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        Entry storage e = _entry(tokenId);
        if (tokenId != _tokenId(_labelId(tokenId), e) || _isExpired(e.expiry)) return address(0);
        return e.owner;
    }

    function getSubregistry(string calldata label) external view returns (IPermissionedRegistry) {
        Entry storage e = _entry(uint256(keccak256(bytes(label))));
        return _isExpired(e.expiry) ? IPermissionedRegistry(address(0)) : e.subregistry;
    }

    function getResolver(string calldata label) external view returns (address) {
        Entry storage e = _entry(uint256(keccak256(bytes(label))));
        return _isExpired(e.expiry) ? address(0) : e.resolver;
    }

    // ---------------------------------------------------------------- minimal ERC1155

    function balanceOf(address account, uint256 tokenId) external view returns (uint256) {
        return account != address(0) && ownerOf(tokenId) == account ? 1 : 0;
    }

    function setApprovalForAll(address operator, bool approved) external {
        isApprovedForAll[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, uint256 amount, bytes calldata)
        external
    {
        if (msg.sender != from && !isApprovedForAll[from][msg.sender]) {
            revert ERC1155MissingApprovalForAll(msg.sender, from);
        }
        if (amount != 1 || ownerOf(tokenId) != from) revert InvalidOwner();
        uint256 resource = _resource(tokenId);
        if (_roles[resource][from] & RegistryRoles.ROLE_CAN_TRANSFER_ADMIN == 0) {
            revert TransferDisallowed(tokenId, from);
        }
        Entry storage e = _entry(tokenId);
        e.owner = to;
        _roles[resource][to] = _roles[resource][from];
        delete _roles[resource][from];
        emit TransferSingle(msg.sender, from, to, tokenId, 1);
    }

    // ---------------------------------------------------------------- internals

    function _checkExpiryAndTokenRoles(uint256 anyId, uint256 roleBitmap)
        internal
        view
        returns (uint256 tokenId, Entry storage e)
    {
        e = _entry(anyId);
        tokenId = _tokenId(_labelId(anyId), e);
        if (_isExpired(e.expiry)) revert LabelExpired(tokenId);
        _checkRoles(_resource(anyId), roleBitmap);
    }

    function _labelId(uint256 anyId) internal pure returns (uint256) {
        return anyId ^ uint32(anyId);
    }

    function _entry(uint256 anyId) internal view returns (Entry storage) {
        return _entries[_labelId(anyId)];
    }

    function _tokenId(uint256 labelId, Entry storage e) internal view returns (uint256) {
        return labelId | e.tokenVersionId;
    }

    /// @dev The resource of an expired entry is the NEXT version, so its roles are inert until revived.
    function _resource(uint256 anyId) internal view returns (uint256) {
        Entry storage e = _entry(anyId);
        return _labelId(anyId) | (_isExpired(e.expiry) ? e.eacVersionId + 1 : e.eacVersionId);
    }

    function _isExpired(uint64 expiry) internal view returns (bool) {
        return block.timestamp >= expiry;
    }
}
