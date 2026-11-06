// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry, IUserRegistryInit} from "./interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {IVerifiableFactory} from "./interfaces/IVerifiableFactory.sol";
import {RegistryRoles} from "./ensv2-local/Roles.sol";
import {NameHash} from "./ensv2-local/NameHash.sol";
import {OnShiftTypes} from "./OnShiftTypes.sol";

/// @title IncidentSwitch ("break glass", AliasGuard folded into OnShift)
/// @notice One org transaction re-points the org registry's `ops` label at an empty registry. Every live
///         pass stops at once, because ShiftGate and PassIssuer follow the live pointer, and the org's
///         resolver publishes `ops.status = incident` for public verifiers.
///
///         Least privilege for the switch itself:
///         - on the org registry it holds only ROLE_SET_SUBREGISTRY
///         - on the org resolver it holds ROLE_SET_TEXT for two records of the org name only
///           (`ops.status`, `ops.incident`), granted with authorizeTextRoles
///         - restore() never points back at an old registry (that would revive every old pass);
///           it deploys a FRESH UserRegistry through the VerifiableFactory.
contract IncidentSwitch {
    IPermissionedRegistry public immutable PARENT;
    IPermissionedResolver public immutable PARENT_RESOLVER;
    bytes32 public immutable ORG_NODE;
    address public immutable ORG;
    IPermissionedRegistry public immutable EMPTY_REGISTRY;
    IVerifiableFactory public immutable FACTORY;
    address public immutable REGISTRY_IMPL;

    /// @dev Roles taken on a fresh registry so it can hand issuance to PassIssuer and admin to the org.
    uint256 internal constant FRESH_ROOT_ROLES =
        (RegistryRoles.ROLE_REGISTRAR
                | RegistryRoles.ROLE_UNREGISTER
                | RegistryRoles.ROLE_RENEW
                | RegistryRoles.ROLE_SET_PARENT
                | RegistryRoles.ROLE_SET_SUBREGISTRY
                | RegistryRoles.ROLE_SET_RESOLVER
                | RegistryRoles.ROLE_UPGRADE) << 128 | RegistryRoles.ROLE_SET_PARENT;

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
        IPermissionedRegistry emptyRegistry,
        IVerifiableFactory factory,
        address registryImpl
    ) {
        PARENT = parent;
        PARENT_RESOLVER = parentResolver;
        ORG_NODE = orgNode;
        ORG = org;
        EMPTY_REGISTRY = emptyRegistry;
        FACTORY = factory;
        REGISTRY_IMPL = registryImpl;
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
}
