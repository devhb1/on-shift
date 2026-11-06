// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry, IUserRegistryInit} from "../src/interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";
import {IVerifiableFactory} from "../src/interfaces/IVerifiableFactory.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {PermissionedRegistry} from "../src/ensv2-local/PermissionedRegistry.sol";
import {PermissionedResolver} from "../src/ensv2-local/PermissionedResolver.sol";
import {VerifiableFactory} from "../src/ensv2-local/VerifiableFactory.sol";
import {RegistryRoles, ResolverRoles} from "../src/ensv2-local/Roles.sol";
import {NameHash} from "../src/ensv2-local/NameHash.sol";
import {PassIssuer} from "../src/PassIssuer.sol";
import {ShiftGate} from "../src/ShiftGate.sol";
import {IncidentSwitch} from "../src/IncidentSwitch.sol";
import {OnShiftTypes} from "../src/OnShiftTypes.sol";

/// @notice Wires OnShift on top of an ENSv2 deployment: either the local ABI-compatible layer, or the
///         real ENSv2 contracts on Sepolia (VerifiableFactory + UserRegistry + PermissionedResolver impls).
///         Every call is made from the current caller context (vm.prank / vm.broadcast as `org`).
abstract contract OnShiftDeployer {
    using NameHash for bytes32;

    struct Infra {
        IVerifiableFactory factory;
        address registryImpl; // UserRegistry implementation
        address resolverImpl; // PermissionedResolver implementation
        string saltTag; // varies proxy salts between deployments by the same deployer
    }

    struct System {
        Infra infra;
        IERC20 usdc;
        IPermissionedRegistry parent; // the org's registry: holds the children of <org>.eth
        IPermissionedResolver parentResolver; // <org>.eth's own resolver
        IPermissionedRegistry ops; // UserRegistry serving *.ops.<org>.eth
        IPermissionedRegistry empty; // break-glass target: no names, no usable roles
        PassIssuer issuer;
        ShiftGate gate;
        IncidentSwitch incidentSwitch;
        bytes32 orgNode;
        bytes32 opsNode;
        bytes orgDnsName;
    }

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 internal constant ORG_REGISTRY_ROLES =
        (RegistryRoles.ROLE_REGISTRAR
                | RegistryRoles.ROLE_UNREGISTER
                | RegistryRoles.ROLE_RENEW
                | RegistryRoles.ROLE_SET_PARENT
                | RegistryRoles.ROLE_SET_SUBREGISTRY
                | RegistryRoles.ROLE_SET_RESOLVER
                | RegistryRoles.ROLE_UPGRADE)
            | ((RegistryRoles.ROLE_REGISTRAR
                    | RegistryRoles.ROLE_UNREGISTER
                    | RegistryRoles.ROLE_RENEW
                    | RegistryRoles.ROLE_SET_PARENT
                    | RegistryRoles.ROLE_SET_SUBREGISTRY
                    | RegistryRoles.ROLE_SET_RESOLVER
                    | RegistryRoles.ROLE_UPGRADE)
                << 128);

    uint256 internal constant ORG_RESOLVER_ROLES = (ResolverRoles.RECORDS | ResolverRoles.ROLE_SET_ALIAS | ResolverRoles.ROLE_UPGRADE)
        | ((ResolverRoles.RECORDS | ResolverRoles.ROLE_SET_ALIAS | ResolverRoles.ROLE_UPGRADE) << 128);

    function _deployLocalInfra() internal returns (Infra memory infra) {
        infra.factory = new VerifiableFactory();
        infra.registryImpl = address(new PermissionedRegistry());
        infra.resolverImpl = address(new PermissionedResolver());
    }

    function _registry(Infra memory infra, string memory salt, address root, uint256 roles)
        internal
        returns (IPermissionedRegistry)
    {
        return IPermissionedRegistry(
            infra.factory
                .deployProxy(
                    infra.registryImpl,
                    uint256(keccak256(bytes(string.concat(infra.saltTag, salt)))),
                    abi.encodeCall(IUserRegistryInit.initialize, (root, roles))
                )
        );
    }

    function _resolver(Infra memory infra, string memory salt, address admin) internal returns (IPermissionedResolver) {
        return IPermissionedResolver(
            infra.factory.deployProxy(
                infra.resolverImpl,
                uint256(keccak256(bytes(string.concat(infra.saltTag, salt)))),
                abi.encodeCall(IPermissionedResolver.initialize, (admin, ORG_RESOLVER_ROLES, new bytes[](0)))
            )
        );
    }

    /// @notice Standalone organisation: its own UserRegistry under a name such as onshift.eth.
    function _deployOnShift(
        address org,
        address treasury,
        IERC20 usdc,
        Infra memory infra,
        string memory orgName
    ) internal returns (System memory s) {
        s.infra = infra;
        s.usdc = usdc;
        s.orgDnsName = NameHash.dnsEncode(orgName);
        s.orgNode = NameHash.namehash(s.orgDnsName);
        s.opsNode = s.orgNode.child("ops");

        s.parent = _registry(infra, string.concat(orgName, "/registry"), org, ORG_REGISTRY_ROLES);
        s.parentResolver = _resolver(infra, string.concat(orgName, "/resolver"), org);
        s.parentResolver.setText(s.orgNode, "description", "OnShift: check staff and agents at ops subnames");
        s.parentResolver.setText(s.orgNode, OnShiftTypes.KEY_OPS_STATUS, "ok");

        _wireShop(s, org, org, treasury, usdc, infra, orgName);
    }

    /// @notice A shop under an existing platform registry: acme.onshift.eth gets its own ops and till.
    /// @param platformOrg Temporary registry admin (the platform wallet that broadcasts the open).
    function _openShopUnder(
        System memory platform,
        string memory platformName,
        string memory label,
        address platformOrg,
        address shopOrg,
        address treasury,
        IERC20 usdc
    ) internal returns (System memory shop) {
        string memory shopName = string.concat(label, ".", platformName);

        shop.infra = platform.infra;
        shop.usdc = usdc;
        shop.orgDnsName = NameHash.dnsEncode(shopName);
        shop.orgNode = NameHash.namehash(shop.orgDnsName);
        shop.opsNode = shop.orgNode.child("ops");

        // Platform deployer is temporary registry admin so one broadcast can wire the shop.
        // PassIssuer / ShiftGate / IncidentSwitch still treat shopOrg as ORG.
        shop.parent = _registry(platform.infra, string.concat(shopName, "/registry"), platformOrg, ORG_REGISTRY_ROLES);
        shop.parentResolver = _resolver(platform.infra, string.concat(shopName, "/resolver"), platformOrg);
        shop.parentResolver.setText(shop.orgNode, "description", string.concat("OnShift shop ", shopName));
        shop.parentResolver.setText(shop.orgNode, OnShiftTypes.KEY_OPS_STATUS, "ok");

        platform.parent.register(
            label,
            shopOrg,
            shop.parent,
            address(shop.parentResolver),
            RegistryRoles.ROLE_SET_SUBREGISTRY | RegistryRoles.ROLE_SET_RESOLVER,
            type(uint64).max
        );
        shop.parent.setParent(platform.parent, label);

        _wireShop(shop, platformOrg, shopOrg, treasury, usdc, platform.infra, shopName);
        shop.parent.grantRootRoles(ORG_REGISTRY_ROLES, shopOrg);
        shop.parentResolver.grantRootRoles(ORG_RESOLVER_ROLES, shopOrg);
    }

    /// @param deployer Wallet that currently holds root roles on s.parent / s.parentResolver.
    /// @param org Wallet that PassIssuer, ShiftGate and IncidentSwitch treat as the organisation.
    function _wireShop(
        System memory s,
        address deployer,
        address org,
        address treasury,
        IERC20 usdc,
        Infra memory infra,
        string memory orgName
    ) private {
        // ops.<org> -> its own UserRegistry. ops has no resolver, so an expired pass has nothing to inherit (C3).
        // Deployer is temporary root so setParent works in the same broadcast; shop org receives the roles after.
        s.ops = _registry(infra, string.concat(orgName, "/ops/0"), deployer, ORG_REGISTRY_ROLES);
        s.empty = _registry(infra, string.concat(orgName, "/empty"), DEAD, RegistryRoles.ROLE_SET_PARENT);
        s.parent.register(
            "ops",
            org,
            s.ops,
            address(0),
            RegistryRoles.ROLE_SET_SUBREGISTRY | RegistryRoles.ROLE_SET_RESOLVER,
            type(uint64).max
        );
        s.ops.setParent(s.parent, "ops");
        if (deployer != org) s.ops.grantRootRoles(ORG_REGISTRY_ROLES, org);

        s.issuer = new PassIssuer(s.parent, infra.factory, infra.resolverImpl, treasury, org, orgName);
        s.ops.grantRootRoles(RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER, address(s.issuer));

        bytes32 tillNode = s.orgNode.child("till");
        bytes memory tillDns = NameHash.dnsEncode(string.concat("till.", orgName));
        bytes memory quarantineDns = NameHash.dnsEncode(string.concat("quarantine.", orgName));
        s.parent.register(
            "till", org, IPermissionedRegistry(address(0)), address(s.parentResolver), 0, type(uint64).max
        );
        s.parent.register(
            "quarantine",
            org,
            IPermissionedRegistry(address(0)),
            address(s.parentResolver),
            0,
            type(uint64).max
        );
        s.parentResolver.setText(tillNode, OnShiftTypes.KEY_TILL_STATUS, "live");
        s.parentResolver.setText(s.orgNode.child("quarantine"), OnShiftTypes.KEY_TILL_STATUS, "quarantine");

        s.gate = new ShiftGate(s.parent, s.parentResolver, usdc, s.opsNode, tillNode, org);
        s.parentResolver.setAddr(tillNode, OnShiftTypes.COIN_TYPE_ETH, abi.encodePacked(address(s.gate)));

        s.incidentSwitch = new IncidentSwitch(
            s.parent,
            s.parentResolver,
            s.orgNode,
            tillNode,
            org,
            address(s.gate),
            address(s.issuer),
            s.empty,
            infra.factory,
            infra.registryImpl,
            tillDns,
            quarantineDns
        );
        s.parent.grantRootRoles(RegistryRoles.ROLE_SET_SUBREGISTRY, address(s.incidentSwitch));
        s.parentResolver.authorizeTextRoles(s.orgDnsName, OnShiftTypes.KEY_OPS_STATUS, address(s.incidentSwitch), true);
        s.parentResolver.authorizeTextRoles(s.orgDnsName, OnShiftTypes.KEY_OPS_INCIDENT, address(s.incidentSwitch), true);
        s.parentResolver.authorizeTextRoles(tillDns, OnShiftTypes.KEY_TILL_STATUS, address(s.incidentSwitch), true);
        s.parentResolver.grantRootRoles(ResolverRoles.ROLE_SET_ALIAS, org);
        uint256 tillResource = uint256(keccak256(abi.encode(tillNode, bytes32(0))));
        (bool granted,) = address(s.parentResolver).call(
            abi.encodeWithSignature(
                "grantRoles(uint256,uint256,address)",
                tillResource,
                ResolverRoles.ROLE_SET_ALIAS,
                address(s.incidentSwitch)
            )
        );
        granted;
    }
}
