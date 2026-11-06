// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {IVerifiableFactory} from "../src/interfaces/IVerifiableFactory.sol";
import {IPermissionedRegistry} from "../src/interfaces/IPermissionedRegistry.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {DeploymentWriter} from "./DeploymentWriter.sol";
import {Playground} from "../src/Playground.sol";
import {SepoliaENSv2} from "./SepoliaENSv2.sol";

/// @notice Sepolia deployment on the REAL ENSv2 contracts (VerifiableFactory, UserRegistry and
///         PermissionedResolver implementations from ensdomains/contracts-v2).
///
///   forge script script/DeploySepolia.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $SEPOLIA_PRIVATE_KEY
///
/// Then register the parent name pointing at the deployed registry + resolver:
///   node ../scripts/register-ens.mjs
contract DeploySepolia is Script, DeploymentWriter {
    function run() external {
        string memory label = vm.envOr("ORG_LABEL", string("onshift"));
        string memory orgName = string.concat(label, ".eth");
        address org = msg.sender;
        address lead = vm.envOr("LEAD_ADDRESS", org);
        address agent = vm.envOr("AGENT_ADDRESS", address(0));
        address treasury = vm.envOr("TREASURY_ADDRESS", org);

        Infra memory infra = Infra({
            factory: IVerifiableFactory(SepoliaENSv2.VERIFIABLE_FACTORY),
            registryImpl: SepoliaENSv2.USER_REGISTRY_IMPL,
            resolverImpl: SepoliaENSv2.PERMISSIONED_RESOLVER_IMPL,
            saltTag: vm.envOr("SALT_TAG", string("onshift-v1"))
        });

        vm.startBroadcast();
        uint256 startBlock = block.number;
        System memory s = _deployOnShift(org, treasury, IERC20(SepoliaENSv2.MOCK_USDC), infra, orgName);
        // make <org>.eth's registry canonical under .eth so the Universal Resolver can walk to it
        s.parent.setParent(IPermissionedRegistry(SepoliaENSv2.ETH_REGISTRY), label);
        s.issuer.setLead(lead, 50, true);
        if (lead != org) s.issuer.setLead(org, 10, true);
        MockUSDC(SepoliaENSv2.MOCK_USDC).mint(address(s.gate), 1_000e6); // ENSv2 testnet MockUSDC: open mint
        Playground playground = new Playground(s.issuer);
        s.issuer.setLead(address(playground), 200, true);
        vm.stopBroadcast();

        string memory path = _write(
            s, "sepolia", "https://sepolia.etherscan.io", orgName, startBlock, org, lead, agent, treasury
        );
        _set("playground", address(playground));
        _set("gateStartBlock", startBlock);
        console2.log("OnShift deployed on Sepolia ENSv2. Addresses written to", path);
    }
}
