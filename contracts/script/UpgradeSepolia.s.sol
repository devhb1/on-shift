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

/// @notice Legacy upgrade helper. Prefer a full DeploySepolia redeploy (A4) so demo sandbox,
///         parameterized gates, and Playground isolation ship together.
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
            keccak256(abi.encodePacked(vm.parseJsonBytes32(json, ".orgNode"), keccak256("till"))),
            false,
            issuer.org()
        );
        uint256 float = oldGate.floatBalance();
        if (float > 0) oldGate.withdrawFloat(address(gate), float);
        Playground playground = new Playground(issuer);
        // New Playground is sandbox-only; clear any legacy ops lead role if present.
        issuer.setLead(address(playground), 0, false);
        issuer.setPlayground(address(playground));
        vm.stopBroadcast();

        _set("shiftGate", address(gate));
        _set("legacyShiftGate", address(oldGate));
        _set("gateStartBlock", startBlock);
        _set("playground", address(playground));
        console2.log("ShiftGate", address(gate));
        console2.log("Playground", address(playground));
        console2.log("float moved", float);
        console2.log("Prefer full DeploySepolia for demo sandbox + sandboxGate");
    }
}
