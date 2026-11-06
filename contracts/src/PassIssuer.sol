// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {IVerifiableFactory} from "./interfaces/IVerifiableFactory.sol";
import {RegistryRoles, ResolverRoles} from "./ensv2-local/Roles.sol";
import {NameHash} from "./ensv2-local/NameHash.sol";
import {OnShiftTypes} from "./OnShiftTypes.sol";
import {PassResolverLib} from "./PassResolverLib.sol";

/// @title PassIssuer
/// @notice Issues expiring, non-transferable, least-privilege ENSv2 subnames ("passes") such as
///         shift-0412.ops.onshift.eth to staff wallets and AI agents.
///
///         Design rules (each one answers a known ENSv2 pitfall):
///         - C1  one PermissionedResolver PER PASS. Resolver grants are keyed by namehash, and a re-issued
///               label has the same namehash, so a shared resolver would let a previous holder's grant
///               survive into the next holder's pass. A fresh instance per pass makes that impossible.
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
    IVerifiableFactory public immutable FACTORY;
    address public immutable RESOLVER_IMPL;
    address public immutable TREASURY;
    /// @dev Organisation authority. Transferable so a Safe can replace an EOA without redeploying.
    address public org;
    bytes32 public immutable OPS_NODE;
    string public orgName;
    /// @dev DNS-encoded "ops.<orgName>", used for per-name resolver grants.
    bytes public opsDnsName;

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
    error ZeroOrg();

    event OrgTransferred(address indexed previous, address indexed next);

    modifier onlyOrg() {
        if (msg.sender != org) revert NotOrg();
        _;
    }

    constructor(
        IPermissionedRegistry parent,
        IVerifiableFactory factory,
        address resolverImpl,
        address treasury,
        address org_,
        string memory orgName_
    ) {
        PARENT = parent;
        FACTORY = factory;
        RESOLVER_IMPL = resolverImpl;
        TREASURY = treasury;
        if (org_ == address(0)) revert ZeroOrg();
        org = org_;
        orgName = orgName_;
        opsDnsName = NameHash.dnsEncode(string.concat("ops.", orgName_));
        OPS_NODE = NameHash.namehash(opsDnsName);

        // Default presets. Caps in USDC base units (6 decimals).
        _addPreset(
            "Cashier", 50e6, 12 hours, OnShiftTypes.ACTION_REFUND | OnShiftTypes.ACTION_CHECK_IN, false
        );
        _addPreset("Support", 25e6, 8 hours, OnShiftTypes.ACTION_REFUND, false);
        _addPreset("AI agent", 20e6, 1 hours, OnShiftTypes.ACTION_REFUND, true);
        _addPreset("Door staff", 0, 12 hours, OnShiftTypes.ACTION_CHECK_IN, false);
    }

    // ---------------------------------------------------------------- org administration

    function transferOrg(address next) external onlyOrg {
        if (next == address(0)) revert ZeroOrg();
        emit OrgTransferred(org, next);
        org = next;
    }

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
        resolver = PassResolverLib.deploy(
            PassResolverLib.Setup({
                factory: FACTORY,
                implementation: RESOLVER_IMPL,
                salt: uint256(keccak256(abi.encode(label, expiry, _passes.length))),
                node: OPS_NODE.child(label),
                dnsName: NameHash.prepend(label, opsDnsName),
                treasury: TREASURY,
                org: org,
                holder: holder,
                orgName: orgName,
                roleName: preset.name,
                agentContext: preset.agent ? agentContext : "",
                scope: OnShiftTypes.Scope({
                    cap: cap, expiry: expiry, actions: preset.actions, presetId: presetId
                })
            })
        );
    }

    // ---------------------------------------------------------------- revocation

    /// @notice End a pass early (e.g. a phone is stolen mid-shift). Expiry needs no transaction.
    function revokeNow(string calldata label) external {
        uint256 indexPlusOne = latestPassIndexPlusOne[keccak256(bytes(label))];
        if (indexPlusOne == 0) revert UnknownPass();
        Pass storage pass = _passes[indexPlusOne - 1];
        if (msg.sender != org && msg.sender != pass.issuer) revert NotAuthorizedToRevoke();
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

    function presetCount() external view returns (uint256) {
        return _presets.length;
    }

    function getPreset(uint8 presetId) external view returns (Preset memory) {
        return _presets[presetId];
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
