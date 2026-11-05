// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {NameHash} from "./ensv2-local/NameHash.sol";
import {OnShiftTypes} from "./OnShiftTypes.sol";

/// @title ShiftGate
/// @notice The place where expiry actually bites. Every gated action re-derives authority from ENS:
///         1. follow the parent's LIVE `ops` pointer (so break-glass kills every pass in one tx)
///         2. liveness = registry getState(labelhash): REGISTERED && now < expiry   (never "does it resolve?", C3)
///         3. caller must be latestOwner (latestOwner ignores expiry, hence step 2 first, C7)
///         4. scope = the pass resolver's issuer-only `pass.scope` data record, bound to this expiry
///
///         The gate holds a small USDC float: that float is the maximum blast radius of the system.
contract ShiftGate {
    using NameHash for bytes32;

    IPermissionedRegistry public immutable PARENT;
    IERC20 public immutable USDC;
    bytes32 public immutable OPS_NODE;
    address public immutable ORG;

    /// @dev keccak256(registry, labelId, expiry) => spent during that one registration
    mapping(bytes32 shiftKey => uint256) public spent;
    mapping(bytes32 orderId => bool) public orderDone;
    mapping(bytes32 ticketId => bool) public ticketDone;

    struct PassStatus {
        bool live;
        uint8 registryStatus;
        uint64 expiry;
        address latestOwner;
        address resolver;
        uint256 cap;
        uint256 spent;
        uint8 actions;
        uint8 presetId;
        string shiftStatus;
    }

    event Refunded(
        string label,
        address indexed holder,
        address indexed customer,
        uint256 amount,
        bytes32 indexed orderId
    );
    event CheckedIn(string label, address indexed holder, bytes32 indexed ticketId);
    event FloatWithdrawn(address indexed to, uint256 amount);

    error PassNotLive();
    error NotPassHolder();
    error ActionNotAllowed();
    error ScopeMismatch();
    error OverCap(uint256 remaining);
    error Replay();
    error NotOrg();
    error TransferFailed();

    constructor(IPermissionedRegistry parent, IERC20 usdc, bytes32 opsNode, address org) {
        PARENT = parent;
        USDC = usdc;
        OPS_NODE = opsNode;
        ORG = org;
    }

    // ---------------------------------------------------------------- gated actions

    function refund(string calldata label, address customer, uint256 amount, bytes32 orderId) external {
        (bytes32 shiftKey, OnShiftTypes.Scope memory scope) = _authorize(label, OnShiftTypes.ACTION_REFUND);
        if (orderDone[orderId]) revert Replay();
        uint256 used = spent[shiftKey];
        if (used + amount > scope.cap) revert OverCap(scope.cap - used);

        orderDone[orderId] = true;
        spent[shiftKey] = used + amount;
        if (!USDC.transfer(customer, amount)) revert TransferFailed();
        emit Refunded(label, msg.sender, customer, amount, orderId);
    }

    function checkIn(string calldata label, bytes32 ticketId) external {
        _authorize(label, OnShiftTypes.ACTION_CHECK_IN);
        if (ticketDone[ticketId]) revert Replay();
        ticketDone[ticketId] = true;
        emit CheckedIn(label, msg.sender, ticketId);
    }

    function _authorize(string calldata label, uint8 action)
        internal
        view
        returns (bytes32 shiftKey, OnShiftTypes.Scope memory scope)
    {
        // 1) the LIVE pointer, every call
        IPermissionedRegistry opsRegistry = PARENT.getSubregistry("ops");
        if (address(opsRegistry).code.length == 0) revert PassNotLive();

        // 2) liveness from registry state only
        uint256 id = NameHash.labelId(label);
        IPermissionedRegistry.State memory s = opsRegistry.getState(id);
        if (s.status != IPermissionedRegistry.Status.REGISTERED || block.timestamp >= s.expiry) {
            revert PassNotLive();
        }

        // 3) the caller is the pass holder
        if (s.latestOwner != msg.sender) revert NotPassHolder();

        // 4) scope from the pass's own resolver, written by the issuer only
        address resolver = opsRegistry.getResolver(label);
        scope = abi.decode(
            IPermissionedResolver(resolver).data(OPS_NODE.child(label), OnShiftTypes.KEY_SCOPE),
            (OnShiftTypes.Scope)
        );
        // a revived (renewed) registration keeps the old scope's expiry -> refuse it (C5 defence in depth)
        if (scope.expiry != s.expiry) revert ScopeMismatch();
        if (scope.actions & action == 0) revert ActionNotAllowed();

        shiftKey = keccak256(abi.encode(address(opsRegistry), id, s.expiry));
    }

    // ---------------------------------------------------------------- views for verifiers and UIs

    /// @notice Everything a public "is this agent on shift?" page needs, derived the same way the gate does.
    function passStatus(string calldata label) external view returns (PassStatus memory p) {
        IPermissionedRegistry opsRegistry = PARENT.getSubregistry("ops");
        if (address(opsRegistry).code.length == 0) return p;

        uint256 id = NameHash.labelId(label);
        IPermissionedRegistry.State memory s = opsRegistry.getState(id);
        p.registryStatus = uint8(s.status);
        p.expiry = s.expiry;
        p.latestOwner = s.latestOwner;
        p.live = s.status == IPermissionedRegistry.Status.REGISTERED && block.timestamp < s.expiry;
        if (!p.live) return p;

        p.resolver = opsRegistry.getResolver(label);
        bytes32 node = OPS_NODE.child(label);
        bytes memory raw = IPermissionedResolver(p.resolver).data(node, OnShiftTypes.KEY_SCOPE);
        if (raw.length == 0) return p;
        OnShiftTypes.Scope memory scope = abi.decode(raw, (OnShiftTypes.Scope));
        if (scope.expiry != s.expiry) {
            p.live = false;
            return p;
        }
        p.cap = scope.cap;
        p.actions = scope.actions;
        p.presetId = scope.presetId;
        p.spent = spent[keccak256(abi.encode(address(opsRegistry), id, s.expiry))];
        p.shiftStatus = IPermissionedResolver(p.resolver).text(node, OnShiftTypes.KEY_STATUS);
    }

    function floatBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    function withdrawFloat(address to, uint256 amount) external {
        if (msg.sender != ORG) revert NotOrg();
        if (!USDC.transfer(to, amount)) revert TransferFailed();
        emit FloatWithdrawn(to, amount);
    }
}
