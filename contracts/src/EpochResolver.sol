// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ResolverRoles} from "./ensv2-local/Roles.sol";

/// @title EpochResolver
/// @notice A shared resolver that keys grants by (namehash, epoch). Re-issuing a label bumps the
///         epoch so the previous holder's grant dies — the C1 leak that forces OnShift to deploy a
///         Permissioned Resolver per pass. Playground can use this path; high-cap cashiers keep a
///         per-pass Permissioned Resolver until this one is proven on every C1–C8 test.
contract EpochResolver {
    uint256 public constant ROOT_RESOURCE = 0;

    mapping(uint256 resource => mapping(address account => uint256)) private _roles;
    mapping(bytes32 node => uint64) public epochOf;
    mapping(bytes32 node => mapping(string key => string)) private _texts;
    mapping(bytes32 node => mapping(uint256 coinType => bytes)) private _addrs;

    event EpochBumped(bytes32 indexed node, uint64 epoch);
    event EACRolesChanged(
        uint256 indexed resource, address indexed account, uint256 oldRoleBitmap, uint256 newRoleBitmap
    );

    error EACUnauthorizedAccountRoles(uint256 resource, uint256 roleBitmap, address account);
    error EACCannotGrantRoles(uint256 resource, uint256 roleBitmap, address account);

    constructor(address admin) {
        _grant(ROOT_RESOURCE, type(uint256).max, admin);
    }

    function resource(bytes32 node, uint64 epoch, bytes32 part) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(node, epoch, part)));
    }

    function bumpEpoch(bytes32 node) external returns (uint64 epoch) {
        if (!hasRoot(ResolverRoles.RECORDS, msg.sender)) {
            revert EACUnauthorizedAccountRoles(ROOT_RESOURCE, ResolverRoles.RECORDS, msg.sender);
        }
        epoch = ++epochOf[node];
        emit EpochBumped(node, epoch);
    }

    function authorizeTextRoles(bytes32 node, string calldata key, address account, bool grant) external {
        uint64 epoch = epochOf[node];
        uint256 res = resource(node, epoch, keccak256(bytes(key)));
        _checkCanGrant(res, ResolverRoles.ROLE_SET_TEXT);
        if (grant) _grant(res, ResolverRoles.ROLE_SET_TEXT, account);
        else _revoke(res, ResolverRoles.ROLE_SET_TEXT, account);
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        uint64 epoch = epochOf[node];
        uint256 res = resource(node, epoch, keccak256(bytes(key)));
        if (!hasRoles(res, ResolverRoles.ROLE_SET_TEXT, msg.sender) && !hasRoot(ResolverRoles.ROLE_SET_TEXT, msg.sender)) {
            revert EACUnauthorizedAccountRoles(res, ResolverRoles.ROLE_SET_TEXT, msg.sender);
        }
        _texts[node][key] = value;
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[node][key];
    }

    function setAddr(bytes32 node, uint256 coinType, bytes calldata value) external {
        if (!hasRoot(ResolverRoles.ROLE_SET_ADDR, msg.sender)) {
            revert EACUnauthorizedAccountRoles(ROOT_RESOURCE, ResolverRoles.ROLE_SET_ADDR, msg.sender);
        }
        _addrs[node][coinType] = value;
    }

    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        return _addrs[node][coinType];
    }

    function hasRoles(uint256 res, uint256 roleBitmap, address account) public view returns (bool) {
        return (_roles[res][account] | _roles[ROOT_RESOURCE][account]) & roleBitmap == roleBitmap;
    }

    function hasRoot(uint256 roleBitmap, address account) public view returns (bool) {
        return _roles[ROOT_RESOURCE][account] & roleBitmap == roleBitmap;
    }

    function _checkCanGrant(uint256 res, uint256 roleBitmap) internal view {
        uint256 adminBits = (_roles[res][msg.sender] | _roles[ROOT_RESOURCE][msg.sender]) >> 128;
        if (roleBitmap & ~(adminBits | (adminBits << 128)) != 0) {
            revert EACCannotGrantRoles(res, roleBitmap, msg.sender);
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
}
