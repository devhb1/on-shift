// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {OnShiftDeployer} from "./OnShiftDeployer.sol";

/// @notice Deploys OnShift + the local ENSv2-semantics layer and writes deployments/<chainId>.json,
///         which the web app reads (no hard-coded addresses in the frontend).
///
///   anvil --block-time 1
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key $ORG_KEY
contract Deploy is Script, OnShiftDeployer {
    function run() external {
        address org = msg.sender;
        address lead = vm.envOr("LEAD_ADDRESS", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        address treasury = vm.envOr("TREASURY_ADDRESS", org);
        address agent = vm.envOr("AGENT_ADDRESS", address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC));

        vm.startBroadcast();
        uint256 startBlock = block.number;
        System memory s = _deployOnShift(org, treasury);
        s.issuer.setLead(lead, 25, true);
        s.issuer.setLead(org, 10, true);
        s.usdc.mint(address(s.gate), 500e6); // the gate float = maximum blast radius
        s.usdc.mint(org, 10_000e6);
        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeString(k, "orgName", ORG_NAME);
        vm.serializeBytes32(k, "orgNode", s.orgNode);
        vm.serializeBytes32(k, "opsNode", s.opsNode);
        vm.serializeAddress(k, "org", org);
        vm.serializeAddress(k, "lead", lead);
        vm.serializeAddress(k, "agent", agent);
        vm.serializeAddress(k, "treasury", treasury);
        vm.serializeAddress(k, "usdc", address(s.usdc));
        vm.serializeAddress(k, "resolverImpl", address(s.resolverImpl));
        vm.serializeAddress(k, "factory", address(s.factory));
        vm.serializeAddress(k, "parentRegistry", address(s.parent));
        vm.serializeAddress(k, "parentResolver", address(s.parentResolver));
        vm.serializeAddress(k, "opsRegistry", address(s.ops));
        vm.serializeAddress(k, "emptyRegistry", address(s.empty));
        vm.serializeAddress(k, "passIssuer", address(s.issuer));
        vm.serializeAddress(k, "shiftGate", address(s.gate));
        string memory json = vm.serializeAddress(k, "incidentSwitch", address(s.incidentSwitch));

        string memory path = string.concat("./deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("OnShift deployed. Addresses written to", path);
        console2.log("PassIssuer    ", address(s.issuer));
        console2.log("ShiftGate     ", address(s.gate));
        console2.log("IncidentSwitch", address(s.incidentSwitch));
    }
}
