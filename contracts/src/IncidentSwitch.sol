// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {PermissionedRegistry} from "./ensv2-local/PermissionedRegistry.sol";
import {RegistryRoles} from "./ensv2-local/Roles.sol";
import {NameHash} from "./ensv2-local/NameHash.sol";
import {OnShiftTypes} from "./OnShiftTypes.sol";

/// @title IncidentSwitch ("break glass", AliasGuard folded into OnShift)
/// @notice One org transaction re-points the parent's `ops` subregistry at an empty registry. Every
///         live pass stops at once, because ShiftGate and PassIssuer follow the live pointer, and the
///         org's resolver publishes `ops.status = incident` for public verifiers.
///
///         Least privilege for the switch itself:
///         - on the parent registry it holds only ROLE_SET_SUBREGISTRY
///         - on the parent resolver it holds KEY-scoped setters for `ops.status` / `ops.incident`,
///           not a resolver-wide text role (resolver roles are root-wide, C8)
///         - restore() never points back at the old registry (that would revive every old pass);
///           it deploys a FRESH registry, so old passes stay dead forever.
contract IncidentSwitch {
    using NameHash for bytes32;

    IPermissionedRegistry public immutable PARENT;
    IPermissionedResolver public immutable PARENT_RESOLVER;
    bytes32 public immutable ORG_NODE;
    address public immutable ORG;
    IPermissionedRegistry public immutable EMPTY_REGISTRY;

    address public passIssuer;
    bool public incident;
    uint64 public lastChangeAt;
    uint32 public epoch;
    string public reason;

    event BreakGlass(address indexed by, string reason, uint32 epoch);
    event Restored(address indexed by, address newRegistry, uint32 epoch);

    error NotOrg();
    error AlreadyInIncident();
    error NotInIncident();
    error IssuerAlreadySet();

    modifier onlyOrg() {
        if (msg.sender != ORG) revert NotOrg();
        _;
    }

    constructor(
        IPermissionedRegistry parent,
        IPermissionedResolver parentResolver,
        bytes32 orgNode,
        address org,
        IPermissionedRegistry emptyRegistry
    ) {
        PARENT = parent;
        PARENT_RESOLVER = parentResolver;
        ORG_NODE = orgNode;
        ORG = org;
        EMPTY_REGISTRY = emptyRegistry;
        lastChangeAt = uint64(block.timestamp);
    }

    /// @notice One-time wiring so restore() can hand issuance rights on the fresh registry to PassIssuer.
    function setPassIssuer(address issuer) external onlyOrg {
        if (passIssuer != address(0)) revert IssuerAlreadySet();
        passIssuer = issuer;
    }

    function breakGlass(string calldata why) external onlyOrg {
        if (incident) revert AlreadyInIncident();
        incident = true;
        reason = why;
        lastChangeAt = uint64(block.timestamp);

        PARENT.setSubregistry(NameHash.labelId("ops"), EMPTY_REGISTRY);
        PARENT_RESOLVER.setText(ORG_NODE, OnShiftTypes.KEY_OPS_STATUS, "incident");
        PARENT_RESOLVER.setText(ORG_NODE, OnShiftTypes.KEY_OPS_INCIDENT, why);
        emit BreakGlass(msg.sender, why, epoch);
    }

    /// @notice Recover into a brand-new namespace. Passes from before the incident never come back.
    function restore() external onlyOrg returns (address fresh) {
        if (!incident) revert NotInIncident();
        incident = false;
        reason = "";
        epoch += 1;
        lastChangeAt = uint64(block.timestamp);

        PermissionedRegistry registry = new PermissionedRegistry(address(this));
        registry.grantRootRoles(RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER, passIssuer);
        registry.grantRootRoles(RegistryRoles.ROLE_ADMIN | RegistryRoles.ROLE_UNREGISTER, ORG);
        fresh = address(registry);

        PARENT.setSubregistry(NameHash.labelId("ops"), IPermissionedRegistry(fresh));
        PARENT_RESOLVER.setText(ORG_NODE, OnShiftTypes.KEY_OPS_STATUS, "ok");
        PARENT_RESOLVER.setText(ORG_NODE, OnShiftTypes.KEY_OPS_INCIDENT, "");
        emit Restored(msg.sender, fresh, epoch);
    }
}
