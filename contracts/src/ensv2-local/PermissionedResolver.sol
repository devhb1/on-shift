// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedResolver} from "../interfaces/IPermissionedResolver.sol";
import {ResolverRoles} from "./Roles.sol";
import {NameHash} from "./NameHash.sol";

/// @title PermissionedResolver (local, ABI-compatible with ensdomains/contracts-v2 PermissionedResolver)
/// @notice Roles live on EAC resources, exactly like the real resolver:
///
///                        any key              one key
///         any name   resource(0, 0)       resource(0, keyHash)
///         one name   resource(node, 0)    resource(node, keyHash)
///
///         A setter succeeds if the caller holds the role on (node, key), on (*, key), or on (node, *),
///         and root roles cover everything. `authorizeTextRoles` grants the narrowest cell.
///
///         Note what this does NOT protect: grants are keyed by namehash, and a re-registered label has
///         the same namehash. That is why OnShift still gives every pass its own resolver instance.
contract PermissionedResolver is IPermissionedResolver {
    uint256 public constant ROOT_RESOURCE = 0;

    bool private _initialized;
    mapping(uint256 resource => mapping(address account => uint256)) private _roles;

    mapping(bytes32 node => mapping(uint256 coinType => bytes)) private _addrs;
    mapping(bytes32 node => mapping(string key => string)) private _texts;
    mapping(bytes32 node => mapping(string key => bytes)) private _data;
    mapping(bytes32 fromNode => bytes32 toNode) private _aliasNode;
    mapping(bytes32 fromNode => bytes toName) private _aliasDns;

    event EACRolesChanged(
        uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap
    );
    event AddressChanged(bytes32 indexed node, uint256 coinType, bytes newAddress);
    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);
    event DataChanged(bytes32 indexed node, string indexed indexedKey, string key, bytes value);
    event AliasChanged(bytes indexed indexedFromName, bytes indexed indexedToName, bytes fromName, bytes toName);

    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);
    error AlreadyInitialized();

    constructor() {
        _initialized = true;
    }

    function initialize(address admin, uint256 roleBitmap, bytes[] calldata setters) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        _grant(ROOT_RESOURCE, roleBitmap, admin);
        for (uint256 i; i < setters.length; ++i) {
            (bool ok, bytes memory err) = address(this).delegatecall(setters[i]);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(err, 32), mload(err))
                }
            }
        }
    }

    // ---------------------------------------------------------------- roles

    function resource(bytes32 node, bytes32 part) public pure returns (uint256) {
        if (node == bytes32(0) && part == bytes32(0)) return ROOT_RESOURCE;
        return uint256(keccak256(abi.encode(node, part)));
    }

    function roles(uint256 res, address account) external view returns (uint256) {
        return _roles[res][account];
    }

    function hasRoles(uint256 res, uint256 roleBitmap, address account) public view returns (bool) {
        return (_roles[res][account] | _roles[ROOT_RESOURCE][account]) & roleBitmap == roleBitmap;
    }

    function hasRootRoles(uint256 roleBitmap, address account) external view returns (bool) {
        return _roles[ROOT_RESOURCE][account] & roleBitmap == roleBitmap;
    }

    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool) {
        _checkCanGrant(ROOT_RESOURCE, roleBitmap);
        _grant(ROOT_RESOURCE, roleBitmap, account);
        return true;
    }

    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool) {
        _checkCanGrant(ROOT_RESOURCE, roleBitmap);
        _revoke(ROOT_RESOURCE, roleBitmap, account);
        return true;
    }

    function authorizeTextRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external
        returns (bool)
    {
        bytes32 node = NameHash.namehash(toName);
        _checkCanGrant(resource(node, 0), ResolverRoles.ROLE_SET_TEXT);
        uint256 part = resource(node, keccak256(bytes(key)));
        if (grant) _grant(part, ResolverRoles.ROLE_SET_TEXT, account);
        else _revoke(part, ResolverRoles.ROLE_SET_TEXT, account);
        return true;
    }

    function grantRoles(uint256 res, uint256 roleBitmap, address account) external returns (bool) {
        _checkCanGrant(res, roleBitmap);
        _grant(res, roleBitmap, account);
        return true;
    }

    function setAlias(bytes calldata fromName, bytes calldata toName) external {
        bytes32 fromNode = NameHash.namehash(fromName);
        _checkPart(fromNode, 0, ResolverRoles.ROLE_SET_ALIAS);
        if (toName.length <= 1) {
            delete _aliasNode[fromNode];
            delete _aliasDns[fromNode];
        } else {
            _aliasNode[fromNode] = NameHash.namehash(toName);
            _aliasDns[fromNode] = toName;
        }
        emit AliasChanged(fromName, toName, fromName, toName);
    }

    function getAlias(bytes calldata name) external view returns (bytes memory) {
        return _aliasDns[NameHash.namehash(name)];
    }

    function _follow(bytes32 node) internal view returns (bytes32) {
        bytes32 to = _aliasNode[node];
        return to == bytes32(0) ? node : to;
    }

    function _checkCanGrant(uint256 res, uint256 roleBitmap) internal view {
        uint256 adminBits = (_roles[res][msg.sender] | _roles[ROOT_RESOURCE][msg.sender]) >> 128;
        if (roleBitmap & ~(adminBits | (adminBits << 128)) != 0) {
            revert EACCannotGrantRoles(res, roleBitmap, msg.sender);
        }
    }

    function _checkPart(bytes32 node, bytes32 part, uint256 role) internal view {
        if (
            part != bytes32(0)
                && (hasRoles(resource(node, part), role, msg.sender)
                    || hasRoles(resource(0, part), role, msg.sender))
        ) {
            return;
        }
        uint256 widest = resource(node, 0);
        if (!hasRoles(widest, role, msg.sender)) {
            revert EACUnauthorizedAccountRoles(widest, role, msg.sender);
        }
    }

    function _grant(uint256 res, uint256 roleBitmap, address account) internal {
        uint256 old = _roles[res][account];
        _roles[res][account] = old | roleBitmap;
        emit EACRolesChanged(res, account, old, old | roleBitmap);
    }

    function _revoke(uint256 res, uint256 roleBitmap, address account) internal {
        uint256 old = _roles[res][account];
        _roles[res][account] = old & ~roleBitmap;
        emit EACRolesChanged(res, account, old, old & ~roleBitmap);
    }

    // ---------------------------------------------------------------- records

    function setAddr(bytes32 node, uint256 coinType, bytes calldata value) external {
        _checkPart(node, keccak256(abi.encode(coinType)), ResolverRoles.ROLE_SET_ADDR);
        _addrs[node][coinType] = value;
        emit AddressChanged(node, coinType, value);
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        _checkPart(node, keccak256(bytes(key)), ResolverRoles.ROLE_SET_TEXT);
        _texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    function setData(bytes32 node, string calldata key, bytes calldata value) external {
        _checkPart(node, keccak256(bytes(key)), ResolverRoles.ROLE_SET_DATA);
        _data[node][key] = value;
        emit DataChanged(node, key, key, value);
    }

    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        return _addrs[_follow(node)][coinType];
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[_follow(node)][key];
    }

    function data(bytes32 node, string calldata key) external view returns (bytes memory) {
        return _data[_follow(node)][key];
    }
}
