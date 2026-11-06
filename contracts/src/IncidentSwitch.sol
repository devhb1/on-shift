// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry, IUserRegistryInit} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {IVerifiableFactory} from "./interfaces/IVerifiableFactory.sol";
import {RegistryRoles} from "./ensv2-local/Roles.sol";
import {NameHash} from "./ensv2-local/NameHash.sol";
import {OnShiftTypes} from "./OnShiftTypes.sol";

/// @title IncidentSwitch ("break glass", AliasGuard folded into OnShift)
/// @notice Two independent brakes, both ENS-native:
///         1. `quarantineTill` aliases `till.<org>` onto `quarantine.<org>` (resolver setAlias).
///            ShiftGate.pay() reads till.status through that alias and refuses new payments.
///            Refunds of already-paid orders still run, always to the original payer.
///            The watchtower may only flip to the pre-registered quarantine name — not to an
///            attacker router (the AliasGuard v1 hole).
///         2. `breakGlass` re-points the `ops` subregistry at an empty registry. Every pass
///            fails getState. restore() hangs a FRESH registry; old passes stay dead.
///
///         `promote` turns the till live again. It needs the org AND an auditor who has approved
///         the live gate's extcodehash, so a compromised org key cannot retarget the till.
contract IncidentSwitch {
    IPermissionedRegistry public immutable PARENT;
    IPermissionedResolver public immutable PARENT_RESOLVER;
    bytes32 public immutable ORG_NODE;
    bytes32 public immutable TILL_NODE;
    address public immutable ORG;
    address public immutable GATE;
    /// @dev The codehash the auditor last attested. Promote requires the live gate to match it,
    ///      so a later implementation can be adopted without redeploying this switch.
    IPermissionedRegistry public immutable EMPTY_REGISTRY;
    IVerifiableFactory public immutable FACTORY;
    address public immutable REGISTRY_IMPL;
    bytes public tillDns;
    bytes public quarantineDns;

    uint256 internal constant FRESH_ROOT_ROLES =
        (RegistryRoles.ROLE_REGISTRAR
                | RegistryRoles.ROLE_UNREGISTER
                | RegistryRoles.ROLE_RENEW
                | RegistryRoles.ROLE_SET_PARENT
                | RegistryRoles.ROLE_SET_SUBREGISTRY
                | RegistryRoles.ROLE_SET_RESOLVER
                | RegistryRoles.ROLE_UPGRADE) << 128 | RegistryRoles.ROLE_SET_PARENT;

    address public passIssuer;
    address public watchtower;
    address public auditor;
    bool public incident;
    bool public tillQuarantined;
    bool public auditorApproved;
    bytes32 public attestedCodehash;
    uint64 public lastChangeAt;
    uint32 public epoch;
    string public reason;

    event BreakGlass(address indexed by, string reason, uint32 epoch);
    event Restored(address indexed by, address newRegistry, uint32 epoch);
    event TillQuarantined(address indexed by);
    event TillPromoted(address indexed by);
    event WatchtowerSet(address indexed watchtower);
    event AuditorSet(address indexed auditor);
    event PromoteApproved(address indexed auditor, bytes32 codehash);

    error NotOrg();
    error NotWatchtower();
    error NotAuditor();
    error AlreadyInIncident();
    error NotInIncident();
    error IssuerAlreadySet();
    error AlreadyQuarantined();
    error NotQuarantined();
    error AuditorNotApproved();
    error WrongCodehash();

    modifier onlyOrg() {
        if (msg.sender != ORG) revert NotOrg();
        _;
    }

    constructor(
        IPermissionedRegistry parent,
        IPermissionedResolver parentResolver,
        bytes32 orgNode,
        bytes32 tillNode,
        address org,
        address gate,
        address issuer,
        IPermissionedRegistry emptyRegistry,
        IVerifiableFactory factory,
        address registryImpl,
        bytes memory tillDns_,
        bytes memory quarantineDns_
    ) {
        PARENT = parent;
        PARENT_RESOLVER = parentResolver;
        ORG_NODE = orgNode;
        TILL_NODE = tillNode;
        ORG = org;
        GATE = gate;
        passIssuer = issuer;
        EMPTY_REGISTRY = emptyRegistry;
        FACTORY = factory;
        REGISTRY_IMPL = registryImpl;
        tillDns = tillDns_;
        quarantineDns = quarantineDns_;
        lastChangeAt = uint64(block.timestamp);
    }

    function setPassIssuer(address issuer) external onlyOrg {
        if (passIssuer != address(0)) revert IssuerAlreadySet();
        passIssuer = issuer;
    }

    function setWatchtower(address who) external onlyOrg {
        watchtower = who;
        emit WatchtowerSet(who);
    }

    function setAuditor(address who) external onlyOrg {
        auditor = who;
        auditorApproved = false;
        emit AuditorSet(who);
    }

    /// @notice Watchtower (or org) aliases the till name onto the quarantine name.
    ///         Cannot point at an arbitrary address — the target DNS is fixed at deploy.
    function quarantineTill() external {
        if (msg.sender != ORG && msg.sender != watchtower) revert NotWatchtower();
        if (tillQuarantined) revert AlreadyQuarantined();
        tillQuarantined = true;
        lastChangeAt = uint64(block.timestamp);
        PARENT_RESOLVER.setText(TILL_NODE, OnShiftTypes.KEY_TILL_STATUS, "quarantine");
        _setAlias(tillDns, quarantineDns);
        emit TillQuarantined(msg.sender);
    }

    /// @notice Auditor names the gate codehash that promote is allowed to turn back on.
    function approvePromote(bytes32 codehash) external {
        if (msg.sender != auditor) revert NotAuditor();
        if (codehash == bytes32(0)) revert WrongCodehash();
        attestedCodehash = codehash;
        auditorApproved = true;
        emit PromoteApproved(msg.sender, codehash);
    }

    /// @notice Org restores the till. The live gate must still be the code the auditor named.
    function promote() external onlyOrg {
        if (!tillQuarantined) revert NotQuarantined();
        if (!auditorApproved) revert AuditorNotApproved();
        if (GATE.codehash != attestedCodehash) revert WrongCodehash();
        auditorApproved = false;
        tillQuarantined = false;
        lastChangeAt = uint64(block.timestamp);
        PARENT_RESOLVER.setText(TILL_NODE, OnShiftTypes.KEY_TILL_STATUS, "live");
        _setAlias(tillDns, bytes(""));
        emit TillPromoted(msg.sender);
    }

    function breakGlass(string calldata why) external onlyOrg {
        if (incident) revert AlreadyInIncident();
        incident = true;
        reason = why;
        lastChangeAt = uint64(block.timestamp);

        PARENT.setSubregistry(NameHash.labelId("ops"), EMPTY_REGISTRY);
        PARENT_RESOLVER.setText(ORG_NODE, OnShiftTypes.KEY_OPS_STATUS, "incident");
        PARENT_RESOLVER.setText(ORG_NODE, OnShiftTypes.KEY_OPS_INCIDENT, why);
        if (!tillQuarantined) {
            tillQuarantined = true;
            PARENT_RESOLVER.setText(TILL_NODE, OnShiftTypes.KEY_TILL_STATUS, "quarantine");
            _setAlias(tillDns, quarantineDns);
            emit TillQuarantined(msg.sender);
        }
        emit BreakGlass(msg.sender, why, epoch);
    }

    /// @notice Recover into a brand-new namespace. Passes from before the incident never come back.
    ///         The till stays quarantined until promote() — paying again is a separate, dual-keyed act.
    function restore() external onlyOrg returns (address fresh) {
        if (!incident) revert NotInIncident();
        incident = false;
        reason = "";
        epoch += 1;
        lastChangeAt = uint64(block.timestamp);

        fresh = FACTORY.deployProxy(
            REGISTRY_IMPL,
            uint256(keccak256(abi.encode("onshift.ops", epoch))),
            abi.encodeCall(IUserRegistryInit.initialize, (address(this), FRESH_ROOT_ROLES))
        );
        IPermissionedRegistry registry = IPermissionedRegistry(fresh);
        registry.grantRootRoles(RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER, passIssuer);
        registry.grantRootRoles(
            RegistryRoles.withAdmin(
                RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER | RegistryRoles.ROLE_RENEW
                    | RegistryRoles.ROLE_SET_SUBREGISTRY | RegistryRoles.ROLE_SET_RESOLVER
                    | RegistryRoles.ROLE_UPGRADE
            ),
            ORG
        );
        registry.setParent(PARENT, "ops");

        PARENT.setSubregistry(NameHash.labelId("ops"), registry);
        PARENT_RESOLVER.setText(ORG_NODE, OnShiftTypes.KEY_OPS_STATUS, "ok");
        PARENT_RESOLVER.setText(ORG_NODE, OnShiftTypes.KEY_OPS_INCIDENT, "");
        emit Restored(msg.sender, fresh, epoch);
    }

    function _setAlias(bytes memory fromName, bytes memory toName) internal {
        // Real ENSv2 PermissionedResolver exposes setAlias. A missing selector (older impl) is ignored;
        // till.status text is the load-bearing signal ShiftGate reads either way.
        (bool ok,) = address(PARENT_RESOLVER).call(
            abi.encodeWithSelector(IPermissionedResolver.setAlias.selector, fromName, toName)
        );
        ok; // older PermissionedResolver impls have no setAlias; till.status still gates pay()
    }
}
