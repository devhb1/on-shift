// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IPermissionedRegistry, IUserRegistryInit} from "../src/interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";
import {IVerifiableFactory} from "../src/interfaces/IVerifiableFactory.sol";
import {RegistryRoles, ResolverRoles} from "../src/ensv2-local/Roles.sol";
import {NameHash} from "../src/ensv2-local/NameHash.sol";
import {PassIssuer} from "../src/PassIssuer.sol";
import {ShiftGate} from "../src/ShiftGate.sol";
import {IncidentSwitch} from "../src/IncidentSwitch.sol";
import {Playground} from "../src/Playground.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {OnShiftTypes} from "../src/OnShiftTypes.sol";
import {DeploymentWriter} from "./DeploymentWriter.sol";

/// @notice In-place Sepolia upgrade under the existing onshift.eth parent: demo sandbox,
///         parameterized gates, Playground that never writes ops.
///
///   SALT_TAG=onshift-v1.0-ethglobal forge script script/UpgradeToSandbox.s.sol \
///     --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $SEPOLIA_PRIVATE_KEY --slow
contract UpgradeToSandbox is Script, DeploymentWriter {
    using NameHash for bytes32;

    function run() external {
        string memory json = vm.readFile(_path());
        string memory orgName = vm.parseJsonString(json, ".orgName");
        address org = vm.parseJsonAddress(json, ".org");
        require(msg.sender == org, "broadcast as the org");

        IPermissionedRegistry parent = IPermissionedRegistry(vm.parseJsonAddress(json, ".parentRegistry"));
        IPermissionedResolver parentResolver = IPermissionedResolver(vm.parseJsonAddress(json, ".parentResolver"));
        IPermissionedRegistry ops = IPermissionedRegistry(vm.parseJsonAddress(json, ".opsRegistry"));
        IPermissionedRegistry empty = IPermissionedRegistry(vm.parseJsonAddress(json, ".emptyRegistry"));
        IERC20 usdc = IERC20(vm.parseJsonAddress(json, ".usdc"));
        IVerifiableFactory factory = IVerifiableFactory(vm.parseJsonAddress(json, ".factory"));
        address registryImpl = vm.parseJsonAddress(json, ".registryImpl");
        address resolverImpl = vm.parseJsonAddress(json, ".resolverImpl");
        address lead = vm.parseJsonAddress(json, ".lead");
        address treasury = vm.parseJsonAddress(json, ".treasury");
        address agent = vm.parseJsonAddress(json, ".agent");
        ShiftGate oldGate = ShiftGate(vm.parseJsonAddress(json, ".shiftGate"));
        address oldIssuer = vm.parseJsonAddress(json, ".passIssuer");
        address oldSwitch = vm.parseJsonAddress(json, ".incidentSwitch");

        bytes32 orgNode = vm.parseJsonBytes32(json, ".orgNode");
        bytes32 opsNode = vm.parseJsonBytes32(json, ".opsNode");
        bytes32 demoNode = orgNode.child("demo");
        bytes32 tillNode = orgNode.child("till");
        bytes32 sandboxTillNode = orgNode.child("sandbox");
        bytes memory orgDns = NameHash.dnsEncode(orgName);
        bytes memory tillDns = NameHash.dnsEncode(string.concat("till.", orgName));
        bytes memory quarantineDns = NameHash.dnsEncode(string.concat("quarantine.", orgName));
        string memory saltTag = vm.envOr("SALT_TAG", string("onshift-v1.0-ethglobal"));

        vm.startBroadcast();
        uint256 startBlock = block.number;

        IPermissionedRegistry demo = IPermissionedRegistry(
            factory.deployProxy(
                registryImpl,
                uint256(keccak256(bytes(string.concat(saltTag, "/", orgName, "/demo")))),
                abi.encodeCall(IUserRegistryInit.initialize, (org, ORG_REGISTRY_ROLES))
            )
        );

        IPermissionedRegistry existingDemo = parent.getSubregistry("demo");
        if (address(existingDemo).code.length == 0) {
            parent.register(
                "demo",
                org,
                demo,
                address(0),
                RegistryRoles.ROLE_SET_SUBREGISTRY | RegistryRoles.ROLE_SET_RESOLVER,
                type(uint64).max
            );
            demo.setParent(parent, "demo");
        } else {
            parent.setSubregistry(NameHash.labelId("demo"), demo);
            demo.setParent(parent, "demo");
        }

        IPermissionedRegistry.State memory sandboxState = parent.getState(NameHash.labelId("sandbox"));
        if (sandboxState.status == IPermissionedRegistry.Status.AVAILABLE) {
            parent.register(
                "sandbox", org, IPermissionedRegistry(address(0)), address(parentResolver), 0, type(uint64).max
            );
        }
        parentResolver.setText(sandboxTillNode, OnShiftTypes.KEY_TILL_STATUS, "live");
        parentResolver.setText(tillNode, OnShiftTypes.KEY_TILL_STATUS, "live");

        PassIssuer issuer = new PassIssuer(parent, factory, resolverImpl, treasury, org, orgName);
        ops.grantRootRoles(RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER, address(issuer));
        demo.grantRootRoles(RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER, address(issuer));
        _revokeRoot(ops, RegistryRoles.ROLE_REGISTRAR | RegistryRoles.ROLE_UNREGISTER, oldIssuer);

        ShiftGate gate = new ShiftGate(parent, parentResolver, usdc, opsNode, tillNode, false, org);
        ShiftGate sandboxGate = new ShiftGate(parent, parentResolver, usdc, demoNode, sandboxTillNode, true, org);
        parentResolver.setAddr(tillNode, OnShiftTypes.COIN_TYPE_ETH, abi.encodePacked(address(gate)));
        parentResolver.setAddr(sandboxTillNode, OnShiftTypes.COIN_TYPE_ETH, abi.encodePacked(address(sandboxGate)));

        uint256 floatBal = oldGate.floatBalance();
        if (floatBal > 0) oldGate.withdrawFloat(address(gate), floatBal);
        MockUSDC(address(usdc)).mint(address(sandboxGate), 100e6);

        IncidentSwitch sw = new IncidentSwitch(
            parent,
            parentResolver,
            orgNode,
            tillNode,
            org,
            address(gate),
            address(issuer),
            empty,
            factory,
            registryImpl,
            tillDns,
            quarantineDns
        );
        parent.grantRootRoles(RegistryRoles.ROLE_SET_SUBREGISTRY, address(sw));
        _revokeRoot(parent, RegistryRoles.ROLE_SET_SUBREGISTRY, oldSwitch);
        parentResolver.authorizeTextRoles(orgDns, OnShiftTypes.KEY_OPS_STATUS, address(sw), true);
        parentResolver.authorizeTextRoles(orgDns, OnShiftTypes.KEY_OPS_INCIDENT, address(sw), true);
        parentResolver.authorizeTextRoles(tillDns, OnShiftTypes.KEY_TILL_STATUS, address(sw), true);
        // Skip till ROLE_SET_ALIAS re-grant: forge broadcasts every external call, and EAC reverts
        // when the org already holds the bits. Org can grantRoles on the till resource later if
        // quarantineTill needs a fresh switch.

        issuer.setLead(lead, 50, true);
        if (lead != org) issuer.setLead(org, 10, true);
        Playground playground = new Playground(issuer);
        issuer.setPlayground(address(playground));

        vm.stopBroadcast();

        System memory s;
        s.usdc = usdc;
        s.parent = parent;
        s.parentResolver = parentResolver;
        s.ops = ops;
        s.demo = demo;
        s.empty = empty;
        s.issuer = issuer;
        s.gate = gate;
        s.sandboxGate = sandboxGate;
        s.incidentSwitch = sw;
        s.orgNode = orgNode;
        s.opsNode = opsNode;
        s.demoNode = demoNode;
        s.sandboxTillNode = sandboxTillNode;
        s.orgDnsName = orgDns;
        s.infra = Infra({
            factory: factory,
            registryImpl: registryImpl,
            resolverImpl: resolverImpl,
            saltTag: saltTag
        });

        string memory path = _write(
            s, "sepolia", "https://sepolia.etherscan.io", orgName, startBlock, org, lead, agent, treasury
        );
        _set("playground", address(playground));
        _set("gateStartBlock", startBlock);
        _set("legacyShiftGate", address(oldGate));
        _set("legacyPassIssuer", oldIssuer);
        _set("legacyIncidentSwitch", oldSwitch);
        console2.log("Upgraded to sandbox Playground. Addresses written to", path);
        console2.log("ShiftGate", address(gate));
        console2.log("SandboxGate", address(sandboxGate));
        console2.log("Playground", address(playground));
        console2.log("PassIssuer", address(issuer));
    }

    function _revokeRoot(IPermissionedRegistry registry, uint256 roles, address account) internal {
        (bool ok,) = address(registry).call(abi.encodeWithSignature("revokeRootRoles(uint256,address)", roles, account));
        ok; // best-effort on older ABIs
    }
}
