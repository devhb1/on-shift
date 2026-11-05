// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedResolver} from "../interfaces/IPermissionedResolver.sol";
import {ResolverRoles} from "./Roles.sol";

/// @title PermissionedResolver (local ENSv2-semantics implementation)
/// @notice Reproduces the property that drives OnShift's architecture: roles are resolver-wide.
///         A holder of ROLE_SET_TEXT can write text on EVERY node this instance serves, and setter
///         roles can be narrowed to a record key but never to a name. Isolation therefore needs one
///         instance per pass, deployed as a minimal proxy by {ResolverFactory}.
contract PermissionedResolver is IPermissionedResolver {
    bool private _initialized;

    mapping(address account => uint256) public roles;
    mapping(bytes32 keyHash => mapping(address account => bool)) public textSetter;

    mapping(bytes32 node => mapping(uint256 coinType => bytes)) private _addrs;
    mapping(bytes32 node => mapping(string key => string)) private _texts;
    mapping(bytes32 node => mapping(string key => bytes)) private _data;

    event RolesChanged(address indexed account, uint256 roles);
    event TextSetterChanged(string key, address indexed account, bool allowed);
    event AddrChanged(bytes32 indexed node, uint256 coinType, bytes value);
    event TextChanged(bytes32 indexed node, string indexed indexedKey, string key, string value);
    event DataChanged(bytes32 indexed node, string indexed indexedKey, string key);

    error Unauthorized(uint256 role, address account);
    error AlreadyInitialized();

    /// @dev Lock the implementation; proxies are initialised through {initialize}.
    constructor() {
        _initialized = true;
    }

    function initialize(address admin) external {
        if (_initialized) revert AlreadyInitialized();
        _initialized = true;
        roles[admin] = ResolverRoles.ALL;
        emit RolesChanged(admin, ResolverRoles.ALL);
    }

    modifier onlyRole(uint256 role) {
        if (roles[msg.sender] & role == 0) revert Unauthorized(role, msg.sender);
        _;
    }

    // ---------------------------------------------------------------- roles

    function grantRoles(uint256 roleBitmap, address account) external onlyRole(ResolverRoles.ROLE_ADMIN) {
        roles[account] |= roleBitmap;
        emit RolesChanged(account, roles[account]);
    }

    function revokeRoles(uint256 roleBitmap, address account) external onlyRole(ResolverRoles.ROLE_ADMIN) {
        roles[account] &= ~roleBitmap;
        emit RolesChanged(account, roles[account]);
    }

    function grantTextSetter(string calldata key, address account)
        external
        onlyRole(ResolverRoles.ROLE_ADMIN)
    {
        textSetter[keccak256(bytes(key))][account] = true;
        emit TextSetterChanged(key, account, true);
    }

    function revokeTextSetter(string calldata key, address account)
        external
        onlyRole(ResolverRoles.ROLE_ADMIN)
    {
        textSetter[keccak256(bytes(key))][account] = false;
        emit TextSetterChanged(key, account, false);
    }

    // ---------------------------------------------------------------- writes

    function setAddr(bytes32 node, uint256 coinType, bytes calldata value)
        external
        onlyRole(ResolverRoles.ROLE_SET_ADDR)
    {
        _addrs[node][coinType] = value;
        emit AddrChanged(node, coinType, value);
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        if (
            roles[msg.sender] & ResolverRoles.ROLE_SET_TEXT == 0
                && !textSetter[keccak256(bytes(key))][msg.sender]
        ) {
            revert Unauthorized(ResolverRoles.ROLE_SET_TEXT, msg.sender);
        }
        _texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    function setData(bytes32 node, string calldata key, bytes calldata value)
        external
        onlyRole(ResolverRoles.ROLE_SET_DATA)
    {
        _data[node][key] = value;
        emit DataChanged(node, key, key);
    }

    // ---------------------------------------------------------------- reads

    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        return _addrs[node][coinType];
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[node][key];
    }

    function data(bytes32 node, string calldata key) external view returns (bytes memory) {
        return _data[node][key];
    }
}
