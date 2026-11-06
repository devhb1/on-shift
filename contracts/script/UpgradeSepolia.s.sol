// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IPermissionedRegistry} from "../src/interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";
import {PassIssuer} from "../src/PassIssuer.sol";
import {ShiftGate} from "../src/ShiftGate.sol";
import {Playground} from "../src/Playground.sol";
import {DeploymentWriter} from "./DeploymentWriter.sol";

/// @notice Adds the order-bound ShiftGate and the Playground to the live Sepolia deployment.
///         The gate only reads ENS and holds no roles, so nothing in ENS changes. The org moves the old
///         gate's float into the new one and registers the Playground as a lead.
///
///   forge script script/UpgradeSepolia.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $SEPOLIA_PRIVATE_KEY
contract UpgradeSepolia is Script, DeploymentWriter {
    function run() external {
        string memory json = vm.readFile(_path());
        PassIssuer issuer = PassIssuer(vm.parseJsonAddress(json, ".passIssuer"));
        ShiftGate oldGate = ShiftGate(vm.parseJsonAddress(json, ".shiftGate"));
        require(msg.sender == issuer.org(), "broadcast as the org");

        vm.startBroadcast();
        uint256 startBlock = block.number;
        ShiftGate gate = new ShiftGate(
            IPermissionedRegistry(vm.parseJsonAddress(json, ".parentRegistry")),
            IPermissionedResolver(vm.parseJsonAddress(json, ".parentResolver")),
            IERC20(vm.parseJsonAddress(json, ".usdc")),
            vm.parseJsonBytes32(json, ".opsNode"),
            keccak256(
                abi.encodePacked(vm.parseJsonBytes32(json, ".orgNode"), keccak256("till"))
            ),
            issuer.org()
        );
        uint256 float = oldGate.floatBalance();
        if (float > 0) oldGate.withdrawFloat(address(gate), float);
        Playground playground = new Playground(issuer);
        issuer.setLead(address(playground), 200, true);
        vm.stopBroadcast();

        _set("shiftGate", address(gate));
        _set("legacyShiftGate", address(oldGate));
        _set("gateStartBlock", startBlock);
        _set("playground", address(playground));
        console2.log("ShiftGate", address(gate));
        console2.log("Playground", address(playground));
        console2.log("float moved", float);
    }
}
