// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "../src/interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {PermissionedRegistry} from "../src/ensv2-local/PermissionedRegistry.sol";
import {PermissionedResolver} from "../src/ensv2-local/PermissionedResolver.sol";
import {ResolverFactory} from "../src/ensv2-local/ResolverFactory.sol";
import {RegistryRoles} from "../src/ensv2-local/Roles.sol";
import {NameHash} from "../src/ensv2-local/NameHash.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {PassIssuer} from "../src/PassIssuer.sol";
import {ShiftGate} from "../src/ShiftGate.sol";
import {IncidentSwitch} from "../src/IncidentSwitch.sol";
import {OnShiftTypes} from "../src/OnShiftTypes.sol";

/// @notice Wires the full OnShift system on top of the local ENSv2-semantics layer.
///         Every call is made from the current caller context (vm.prank / vm.broadcast as `org`).
abstract contract OnShiftDeployer {
    using NameHash for bytes32;

    struct System {
        MockUSDC usdc;
        PermissionedResolver resolverImpl;
        ResolverFactory factory;
        PermissionedRegistry parent; // registry holding the children of acme.eth
        PermissionedResolver parentResolver; // acme.eth's own resolver
        PermissionedRegistry ops; // UserRegistry serving *.ops.acme.eth
        PermissionedRegistry empty; // break-glass target: no roles, no names
        PassIssuer issuer;
        ShiftGate gate;
        IncidentSwitch incidentSwitch;
        bytes32 orgNode;
        bytes32 opsNode;
    }

    string internal constant ORG_LABEL = "acme";
    string internal constant ORG_NAME = "acme.eth";

    function _deployOnShift(address org, address treasury) internal returns (System memory s) {
        s.orgNode = bytes32(0).child("eth").child(ORG_LABEL);
        s.opsNode = s.orgNode.child("ops");

        s.usdc = new MockUSDC();
        s.resolverImpl = new PermissionedResolver();
        s.factory = new ResolverFactory();

        // acme.eth: its subregistry and its own resolver (owned by the org multisig)
        s.parent = new PermissionedRegistry(org);
        s.parentResolver = PermissionedResolver(
            s.factory
                .deployProxy(
                    address(s.resolverImpl),
                    keccak256(bytes(ORG_NAME)),
                    abi.encodeCall(IPermissionedResolver.initialize, (org))
                )
        );
        s.parentResolver
            .setText(s.orgNode, "description", "Acme Corp - staff and agents verify at ops.acme.eth");
        s.parentResolver.setText(s.orgNode, OnShiftTypes.KEY_OPS_STATUS, "ok");

        // ops.acme.eth -> UserRegistry. No resolver on `ops` itself, and the parent resolver keeps no
        // default records for children, so an expired pass has nothing to fall back to (C3).
        s.ops = new PermissionedRegistry(org);
        s.empty = new PermissionedRegistry(address(0));
        s.parent
            .register(
                "ops",
                org,
                IPermissionedRegistry(address(s.ops)),
                address(0),
                RegistryRoles.ROLE_SET_SUBREGISTRY | RegistryRoles.ROLE_SET_RESOLVER,
                type(uint64).max
            );

        s.issuer = new PassIssuer(
            IPermissionedRegistry(address(s.parent)),
            s.factory,
            address(s.resolverImpl),
            treasury,
            org,
            s.opsNode,
            ORG_NAME
        );
        // PassIssuer: register + unregister only. Deliberately NO ROLE_RENEW (C5).
        s.ops.grantRootRoles(RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER, address(s.issuer));

        s.gate =
            new ShiftGate(IPermissionedRegistry(address(s.parent)), IERC20(address(s.usdc)), s.opsNode, org);

        s.incidentSwitch = new IncidentSwitch(
            IPermissionedRegistry(address(s.parent)),
            IPermissionedResolver(address(s.parentResolver)),
            s.orgNode,
            org,
            IPermissionedRegistry(address(s.empty))
        );
        s.parent.grantRootRoles(RegistryRoles.ROLE_SET_SUBREGISTRY, address(s.incidentSwitch));
        s.parentResolver.grantTextSetter(OnShiftTypes.KEY_OPS_STATUS, address(s.incidentSwitch));
        s.parentResolver.grantTextSetter(OnShiftTypes.KEY_OPS_INCIDENT, address(s.incidentSwitch));
        s.incidentSwitch.setPassIssuer(address(s.issuer));
    }
}
