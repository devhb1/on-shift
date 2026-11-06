// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {OnShiftDeployer} from "./OnShiftDeployer.sol";

/// @notice Writes deployments/<chainId>.json, which the web app reads (no hard-coded addresses in the UI).
abstract contract DeploymentWriter is OnShiftDeployer {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function _write(
        System memory s,
        string memory network,
        string memory explorer,
        string memory orgName,
        uint256 startBlock,
        address org,
        address lead,
        address agent,
        address treasury
    ) internal returns (string memory path) {
        string memory k = "deployment";
        VM.serializeString(k, "network", network);
        VM.serializeString(k, "explorer", explorer);
        VM.serializeUint(k, "chainId", block.chainid);
        VM.serializeUint(k, "startBlock", startBlock);
        VM.serializeString(k, "orgName", orgName);
        VM.serializeBytes32(k, "orgNode", s.orgNode);
        VM.serializeBytes32(k, "opsNode", s.opsNode);
        VM.serializeAddress(k, "org", org);
        VM.serializeAddress(k, "lead", lead);
        VM.serializeAddress(k, "agent", agent);
        VM.serializeAddress(k, "treasury", treasury);
        VM.serializeAddress(k, "usdc", address(s.usdc));
        VM.serializeAddress(k, "factory", address(s.infra.factory));
        VM.serializeAddress(k, "registryImpl", s.infra.registryImpl);
        VM.serializeAddress(k, "resolverImpl", s.infra.resolverImpl);
        VM.serializeAddress(k, "parentRegistry", address(s.parent));
        VM.serializeAddress(k, "parentResolver", address(s.parentResolver));
        VM.serializeAddress(k, "opsRegistry", address(s.ops));
        VM.serializeAddress(k, "emptyRegistry", address(s.empty));
        VM.serializeAddress(k, "passIssuer", address(s.issuer));
        VM.serializeAddress(k, "shiftGate", address(s.gate));
        string memory json = VM.serializeAddress(k, "incidentSwitch", address(s.incidentSwitch));
        path = string.concat("./deployments/", VM.toString(block.chainid), ".json");
        VM.writeJson(json, path);
    }
}
