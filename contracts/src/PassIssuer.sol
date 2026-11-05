// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {ResolverFactory} from "./ensv2-local/ResolverFactory.sol";
import {RegistryRoles, ResolverRoles} from "./ensv2-local/Roles.sol";
import {NameHash} from "./ensv2-local/NameHash.sol";
import {OnShiftTypes} from "./OnShiftTypes.sol";

/// @title PassIssuer
/// @notice Issues expiring, non-transferable, least-privilege ENSv2 subnames ("passes") such as
///         shift-0412.ops.acme.eth to staff wallets and AI agents.
///
///         Design rules (each one answers a known ENSv2 pitfall):
///         - C1  one PermissionedResolver PER PASS: resolver roles have no per-name scoping
///         - C4  roleBitmap = 0 on registration: nothing to transfer, re-point or delegate
///         - C5  this contract never holds ROLE_RENEW: extending a shift = a new pass + fresh resolver
///         - C7  everything keyed by labelhash; token IDs are treated as mutable
///         - the `ops` subregistry is always read through the parent's LIVE pointer, so a break-glass
///           re-point (IncidentSwitch) also stops issuance into the dead namespace
contract PassIssuer {
    using NameHash for bytes32;

    struct Preset {
        string name;
        uint256 maxCap;
        uint64 maxDuration;
        uint8 actions;
        bool agent;
        bool active;
    }

    struct Lead {
        uint32 dailyBudget;
        bool active;
    }

    struct Pass {
        string label;
        address holder;
        address issuer;
        address resolver;
        address registry;
        uint64 issuedAt;
        uint64 expiry;
        uint8 presetId;
        uint256 cap;
    }

    uint64 public constant MIN_DURATION = 30 seconds;
    uint64 public constant MAX_DURATION = 12 hours;
    uint256 public constant MAX_GAS_DRIP = 0.05 ether;

    IPermissionedRegistry public immutable PARENT;
    ResolverFactory public immutable FACTORY;
    address public immutable RESOLVER_IMPL;
    address public immutable TREASURY;
    address public immutable ORG;
    bytes32 public immutable OPS_NODE;
    string public orgName;

    Preset[] internal _presets;
    Pass[] internal _passes;
    mapping(address lead => Lead) public leads;
    mapping(address lead => mapping(uint256 day => uint32)) public issuedOnDay;
    mapping(bytes32 labelhash => uint256) public latestPassIndexPlusOne;

    event PassIssued(
        uint256 indexed index,
        string label,
        address indexed holder,
        address indexed issuer,
        uint8 presetId,
        uint64 expiry,
        uint256 cap,
        address resolver,
        uint256 tokenId
    );
    event PassRevoked(uint256 indexed index, string label, address indexed by);
    event LeadUpdated(address indexed lead, uint32 dailyBudget, bool active);
    event PresetUpdated(
        uint8 indexed presetId, string name, uint256 maxCap, uint64 maxDuration, uint8 actions
    );

    error NotOrg();
    error NotLead();
    error NotAuthorizedToRevoke();
    error DailyBudgetExhausted();
    error InvalidDuration();
    error InvalidPreset();
    error CapAboveLimit();
    error InvalidLabel();
    error InvalidHolder();
    error GasDripTooHigh();
    error GasDripFailed();
    error UnknownPass();
    error NamespaceFrozen();

    modifier onlyOrg() {
        if (msg.sender != ORG) revert NotOrg();
        _;
    }

    constructor(
        IPermissionedRegistry parent,
        ResolverFactory factory,
        address resolverImpl,
        address treasury,
        address org,
        bytes32 opsNode,
        string memory orgName_
    ) {
        PARENT = parent;
        FACTORY = factory;
        RESOLVER_IMPL = resolverImpl;
        TREASURY = treasury;
        ORG = org;
        OPS_NODE = opsNode;
        orgName = orgName_;

        // Default presets. Caps in USDC base units (6 decimals).
        _addPreset(
            "Cashier", 50e6, 12 hours, OnShiftTypes.ACTION_REFUND | OnShiftTypes.ACTION_CHECK_IN, false
        );
        _addPreset("Support", 25e6, 8 hours, OnShiftTypes.ACTION_REFUND, false);
        _addPreset("AI agent", 20e6, 1 hours, OnShiftTypes.ACTION_REFUND, true);
        _addPreset("Door staff", 0, 12 hours, OnShiftTypes.ACTION_CHECK_IN, false);
    }

    // ---------------------------------------------------------------- org administration

    function setLead(address lead, uint32 dailyBudget, bool active) external onlyOrg {
        leads[lead] = Lead(dailyBudget, active);
        emit LeadUpdated(lead, dailyBudget, active);
    }

    function addPreset(string calldata name, uint256 maxCap, uint64 maxDuration, uint8 actions, bool agent)
        external
        onlyOrg
    {
        _addPreset(name, maxCap, maxDuration, actions, agent);
    }

    function setPresetActive(uint8 presetId, bool active) external onlyOrg {
        if (presetId >= _presets.length) revert InvalidPreset();
        _presets[presetId].active = active;
    }

    function _addPreset(string memory name, uint256 maxCap, uint64 maxDuration, uint8 actions, bool agent)
        internal
    {
        if (maxDuration < MIN_DURATION || maxDuration > MAX_DURATION) revert InvalidDuration();
        _presets.push(Preset(name, maxCap, maxDuration, actions, agent, true));
        emit PresetUpdated(uint8(_presets.length - 1), name, maxCap, maxDuration, actions);
    }

    // ---------------------------------------------------------------- issuance

    /// @notice The `ops` registry the parent currently points at (changes on break-glass / restore).
    function ops() public view returns (IPermissionedRegistry) {
        return PARENT.getSubregistry("ops");
    }

    /// @notice Issue a pass. Any ETH sent is forwarded to the holder as a gas allowance.
    function issue(
        string calldata label,
        address holder,
        uint8 presetId,
        uint64 duration,
        uint256 cap,
        string calldata agentContext
    ) external payable returns (uint256 tokenId) {
        Lead storage lead = leads[msg.sender];
        if (!lead.active) revert NotLead();
        uint256 day = block.timestamp / 1 days;
        if (issuedOnDay[msg.sender][day] >= lead.dailyBudget) revert DailyBudgetExhausted();
        if (holder == address(0)) revert InvalidHolder();
        if (msg.value > MAX_GAS_DRIP) revert GasDripTooHigh();
        _validateLabel(label);

        if (presetId >= _presets.length || !_presets[presetId].active) revert InvalidPreset();
        Preset storage preset = _presets[presetId];
        if (duration < MIN_DURATION || duration > preset.maxDuration) revert InvalidDuration();
        if (cap > preset.maxCap) revert CapAboveLimit();

        IPermissionedRegistry opsRegistry = ops();
        // after break-glass the live pointer is an empty registry where this contract holds no roles
        if (
            address(opsRegistry).code.length == 0
                || !opsRegistry.hasRootRoles(RegistryRoles.ROLE_REGISTRAR, address(this))
        ) revert NamespaceFrozen();

        issuedOnDay[msg.sender][day] += 1;
        uint64 expiry = uint64(block.timestamp) + duration;

        // 1) a resolver that serves ONLY this pass (C1)
        address resolver = _deployPassResolver(label, holder, presetId, expiry, cap, agentContext);

        // 2) the pass itself: roleBitmap = 0 -> cannot transfer, re-point or delegate (C4)
        tokenId = opsRegistry.register(label, holder, IPermissionedRegistry(address(0)), resolver, 0, expiry);

        _passes.push(
            Pass({
                label: label,
                holder: holder,
                issuer: msg.sender,
                resolver: resolver,
                registry: address(opsRegistry),
                issuedAt: uint64(block.timestamp),
                expiry: expiry,
                presetId: presetId,
                cap: cap
            })
        );
        uint256 index = _passes.length - 1;
        latestPassIndexPlusOne[keccak256(bytes(label))] = index + 1;
        emit PassIssued(index, label, holder, msg.sender, presetId, expiry, cap, resolver, tokenId);

        // 3) gas allowance so staff never need a faucet
        if (msg.value > 0) {
            (bool ok,) = holder.call{value: msg.value}("");
            if (!ok) revert GasDripFailed();
        }
    }

    function _deployPassResolver(
        string calldata label,
        address holder,
        uint8 presetId,
        uint64 expiry,
        uint256 cap,
        string calldata agentContext
    ) internal returns (address resolver) {
        Preset storage preset = _presets[presetId];
        bytes32 node = OPS_NODE.child(label);
        resolver = FACTORY.deployProxy(
            RESOLVER_IMPL,
            keccak256(abi.encode(label, expiry, _passes.length)),
            abi.encodeCall(IPermissionedResolver.initialize, (address(this)))
        );
        IPermissionedResolver r = IPermissionedResolver(resolver);

        // issuer-only records
        r.setAddr(node, OnShiftTypes.COIN_TYPE_ETH, abi.encodePacked(TREASURY));
        r.setData(
            node,
            OnShiftTypes.KEY_SCOPE,
            abi.encode(
                OnShiftTypes.Scope({cap: cap, expiry: expiry, actions: preset.actions, presetId: presetId})
            )
        );
        r.setText(node, OnShiftTypes.KEY_ORG, orgName);
        r.setText(node, OnShiftTypes.KEY_ROLE, preset.name);
        r.setText(node, OnShiftTypes.KEY_STATUS, "Starting shift");
        if (preset.agent && bytes(agentContext).length > 0) {
            r.setText(node, OnShiftTypes.KEY_AGENT_CONTEXT, agentContext);
        }

        // the holder may write exactly one text key, and nothing else
        r.grantTextSetter(OnShiftTypes.KEY_STATUS, holder);
        // the org multisig keeps admin (and ROLE_UPGRADE) over every pass resolver
        r.grantRoles(ResolverRoles.ALL, ORG);
    }

    // ---------------------------------------------------------------- revocation

    /// @notice End a pass early (e.g. a phone is stolen mid-shift). Expiry needs no transaction.
    function revokeNow(string calldata label) external {
        uint256 indexPlusOne = latestPassIndexPlusOne[keccak256(bytes(label))];
        if (indexPlusOne == 0) revert UnknownPass();
        Pass storage pass = _passes[indexPlusOne - 1];
        if (msg.sender != ORG && msg.sender != pass.issuer) revert NotAuthorizedToRevoke();
        IPermissionedRegistry(pass.registry).unregister(NameHash.labelId(label));
        emit PassRevoked(indexPlusOne - 1, label, msg.sender);
    }

    // NOTE: there is deliberately no renew(). In ENSv2, renew() on an expired name revives the old
    // owner and roles (C5). Extending a shift means issuing a new pass with a fresh resolver.

    // ---------------------------------------------------------------- views

    function passCount() external view returns (uint256) {
        return _passes.length;
    }

    function getPass(uint256 index) external view returns (Pass memory) {
        return _passes[index];
    }

    function getPassByLabel(string calldata label) external view returns (Pass memory pass, bool found) {
        uint256 indexPlusOne = latestPassIndexPlusOne[keccak256(bytes(label))];
        if (indexPlusOne == 0) return (pass, false);
        return (_passes[indexPlusOne - 1], true);
    }

    function presetCount() external view returns (uint256) {
        return _presets.length;
    }

    function getPreset(uint8 presetId) external view returns (Preset memory) {
        return _presets[presetId];
    }

    function remainingBudget(address lead) external view returns (uint32) {
        Lead storage l = leads[lead];
        if (!l.active) return 0;
        uint32 used = issuedOnDay[lead][block.timestamp / 1 days];
        return used >= l.dailyBudget ? 0 : l.dailyBudget - used;
    }

    function nodeOf(string calldata label) external view returns (bytes32) {
        return OPS_NODE.child(label);
    }

    /// @dev Labels: 1-32 chars of [a-z0-9-], no leading/trailing hyphen (keeps names unambiguous).
    function _validateLabel(string calldata label) internal pure {
        bytes calldata b = bytes(label);
        if (b.length == 0 || b.length > 32 || b[0] == "-" || b[b.length - 1] == "-") revert InvalidLabel();
        for (uint256 i; i < b.length; ++i) {
            bytes1 c = b[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-";
            if (!ok) revert InvalidLabel();
        }
    }
}
