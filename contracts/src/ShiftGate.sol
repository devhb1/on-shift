// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {IERC20} from "./interfaces/IERC20.sol";
import {NameHash} from "./ensv2-local/NameHash.sol";
import {OnShiftTypes} from "./OnShiftTypes.sol";

/// @title ShiftGate
/// @notice The place where expiry actually bites. Every gated action re-derives authority from ENS:
///         1. follow the parent's LIVE registry pointer for this gate (`ops` or `demo`)
///         2. liveness = registry getState(labelhash): REGISTERED && now < expiry   (never "does it resolve?", C3)
///         3. caller must be latestOwner (latestOwner ignores expiry, hence step 2 first, C7)
///         4. scope = the pass resolver's issuer-only `pass.scope` data record, bound to this expiry
///
///         Refunds are bound to orders paid through `pay()`: the money can only go back to the wallet that
///         paid, and never more than it paid. A pass holder cannot name the recipient, so the cap bounds
///         mistakes and the order binding rules out self-dealing.
///
///         Production gates use registry label "ops". The Playground sandbox uses a second gate on "demo"
///         so demo passes never share float or orders with the real till.
contract ShiftGate {
    using NameHash for bytes32;

    IPermissionedRegistry public immutable PARENT;
    IPermissionedResolver public immutable TILL_RESOLVER;
    IERC20 public immutable USDC;
    /// @dev Namehash of the pass namespace (`ops.<org>` or `demo.<org>`).
    bytes32 public immutable OPS_NODE;
    bytes32 public immutable TILL_NODE;
    /// @dev When true, this gate reads `demo` (Playground sandbox). When false, it reads `ops`.
    bool public immutable IS_DEMO;
    address public org;

    /// @dev keccak256(registry, labelId, expiry) => spent during that one registration
    mapping(bytes32 shiftKey => uint256) public spent;
    mapping(bytes32 orderId => Order) public orders;
    mapping(address payer => uint256) public orderNonce;
    mapping(bytes32 ticketId => bool) public ticketDone;

    struct Order {
        address payer;
        uint128 paid;
        uint128 refunded;
    }

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

    event Paid(bytes32 indexed orderId, address indexed payer, uint256 amount);
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
    error InvalidAmount();
    error UnknownOrder();
    error OverRefund(uint256 refundable);
    error TillNotLive();
    error ZeroOrg();

    event OrgTransferred(address indexed previous, address indexed next);

    constructor(
        IPermissionedRegistry parent,
        IPermissionedResolver tillResolver,
        IERC20 usdc,
        bytes32 opsNode,
        bytes32 tillNode,
        bool isDemo,
        address org_
    ) {
        PARENT = parent;
        TILL_RESOLVER = tillResolver;
        USDC = usdc;
        OPS_NODE = opsNode;
        TILL_NODE = tillNode;
        IS_DEMO = isDemo;
        if (org_ == address(0)) revert ZeroOrg();
        org = org_;
    }

    function registryLabel() public view returns (string memory) {
        return IS_DEMO ? "demo" : "ops";
    }

    function transferOrg(address next) external {
        if (msg.sender != org) revert NotOrg();
        if (next == address(0)) revert ZeroOrg();
        emit OrgTransferred(org, next);
        org = next;
    }

    // ---------------------------------------------------------------- gated actions

    /// @notice A customer pays the shop. The order id is derived on chain so nobody can claim another's.
    function pay(uint256 amount) external returns (bytes32 orderId) {
        if (!_tillLive()) revert TillNotLive();
        if (amount == 0 || amount > type(uint128).max) revert InvalidAmount();
        orderId = keccak256(abi.encode(address(this), msg.sender, orderNonce[msg.sender]++));
        orders[orderId] = Order(msg.sender, uint128(amount), 0);
        if (!USDC.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Paid(orderId, msg.sender, amount);
    }

    /// @notice Refund part or all of a paid order, always to the wallet that paid it.
    function refund(string calldata label, bytes32 orderId, uint256 amount) external {
        (bytes32 shiftKey, OnShiftTypes.Scope memory scope) = _authorize(label, OnShiftTypes.ACTION_REFUND);
        if (amount == 0) revert InvalidAmount();
        Order storage order = orders[orderId];
        address payer = order.payer;
        if (payer == address(0)) revert UnknownOrder();
        uint256 left = order.paid - order.refunded;
        if (amount > left) revert OverRefund(left);
        uint256 used = spent[shiftKey];
        if (used + amount > scope.cap) revert OverCap(scope.cap - used);

        order.refunded += uint128(amount);
        spent[shiftKey] = used + amount;
        if (!USDC.transfer(payer, amount)) revert TransferFailed();
        emit Refunded(label, msg.sender, payer, amount, orderId);
    }

    function refundable(bytes32 orderId) external view returns (uint256) {
        Order storage order = orders[orderId];
        return order.paid - order.refunded;
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
        // 1) the LIVE pointer for this gate's registry label, every call
        IPermissionedRegistry passRegistry = PARENT.getSubregistry(registryLabel());
        if (address(passRegistry).code.length == 0) revert PassNotLive();

        // 2) liveness from registry state only
        uint256 id = NameHash.labelId(label);
        IPermissionedRegistry.State memory s = passRegistry.getState(id);
        if (s.status != IPermissionedRegistry.Status.REGISTERED || block.timestamp >= s.expiry) {
            revert PassNotLive();
        }

        // 3) the caller is the pass holder
        if (s.latestOwner != msg.sender) revert NotPassHolder();

        // 4) scope from the pass's own resolver, written by the issuer only
        address resolver = passRegistry.getResolver(label);
        scope = abi.decode(
            IPermissionedResolver(resolver).data(OPS_NODE.child(label), OnShiftTypes.KEY_SCOPE),
            (OnShiftTypes.Scope)
        );
        // a revived (renewed) registration keeps the old scope's expiry -> refuse it (C5 defence in depth)
        if (scope.expiry != s.expiry) revert ScopeMismatch();
        if (scope.actions & action == 0) revert ActionNotAllowed();

        shiftKey = keccak256(abi.encode(address(passRegistry), id, s.expiry));
    }

    // ---------------------------------------------------------------- views for verifiers and UIs

    /// @notice Everything a public "is this agent on shift?" page needs, derived the same way the gate does.
    function passStatus(string calldata label) external view returns (PassStatus memory p) {
        IPermissionedRegistry passRegistry = PARENT.getSubregistry(registryLabel());
        if (address(passRegistry).code.length == 0) return p;

        uint256 id = NameHash.labelId(label);
        IPermissionedRegistry.State memory s = passRegistry.getState(id);
        p.registryStatus = uint8(s.status);
        p.expiry = s.expiry;
        p.latestOwner = s.latestOwner;
        p.live = s.status == IPermissionedRegistry.Status.REGISTERED && block.timestamp < s.expiry;
        if (!p.live) return p;

        p.resolver = passRegistry.getResolver(label);
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
        p.spent = spent[keccak256(abi.encode(address(passRegistry), id, s.expiry))];
        p.shiftStatus = IPermissionedResolver(p.resolver).text(node, OnShiftTypes.KEY_STATUS);
    }

    function tillLive() external view returns (bool) {
        return _tillLive();
    }

    function _tillLive() internal view returns (bool) {
        return keccak256(bytes(TILL_RESOLVER.text(TILL_NODE, OnShiftTypes.KEY_TILL_STATUS)))
            == keccak256("live");
    }

    function floatBalance() external view returns (uint256) {
        return USDC.balanceOf(address(this));
    }

    function withdrawFloat(address to, uint256 amount) external {
        if (msg.sender != org) revert NotOrg();
        if (!USDC.transfer(to, amount)) revert TransferFailed();
        emit FloatWithdrawn(to, amount);
    }
}
