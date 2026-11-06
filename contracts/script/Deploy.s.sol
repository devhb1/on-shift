// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {DeploymentWriter} from "./DeploymentWriter.sol";

/// @notice Local deployment: the ABI-compatible ENSv2 layer + OnShift on Anvil.
///
///   anvil --block-time 1
///   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast --private-key $ORG_KEY
contract Deploy is Script, DeploymentWriter {
    string internal constant ORG_NAME = "onshift.eth";

    function run() external {
        address org = msg.sender;
        address lead = vm.envOr("LEAD_ADDRESS", address(0x70997970C51812dc3A010C7d01b50e0d17dc79C8));
        address agent = vm.envOr("AGENT_ADDRESS", address(0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC));
        address treasury = vm.envOr("TREASURY_ADDRESS", org);

        vm.startBroadcast();
        uint256 startBlock = block.number;
        MockUSDC usdc = new MockUSDC();
        System memory s = _deployOnShift(org, treasury, IERC20(address(usdc)), _deployLocalInfra(), ORG_NAME);
        s.issuer.setLead(lead, 25, true);
        s.issuer.setLead(org, 10, true);
        usdc.mint(address(s.gate), 500e6); // the gate float = maximum blast radius
        vm.stopBroadcast();

        string memory path = _write(s, "local", "", ORG_NAME, startBlock, org, lead, agent, treasury);
        console2.log("OnShift deployed locally. Addresses written to", path);
    }
}
