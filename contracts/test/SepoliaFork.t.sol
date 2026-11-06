// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OnShiftSuite} from "./OnShift.t.sol";
import {IVerifiableFactory} from "../src/interfaces/IVerifiableFactory.sol";
import {SepoliaENSv2} from "../script/SepoliaENSv2.sol";

/// @notice The full OnShift suite against the REAL ENSv2 contracts deployed on Sepolia
///         (ensdomains/contracts-v2: VerifiableFactory, UserRegistry, PermissionedResolver).
///
///   SEPOLIA_RPC_URL=... forge test --match-contract SepoliaForkTest
///
/// Skipped when SEPOLIA_RPC_URL is not set, so `forge test` stays offline by default.
contract SepoliaForkTest is OnShiftSuite {
    function setUp() public override {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);
        super.setUp();
    }

    function _infra() internal pure override returns (Infra memory) {
        return Infra({
            factory: IVerifiableFactory(SepoliaENSv2.VERIFIABLE_FACTORY),
            registryImpl: SepoliaENSv2.USER_REGISTRY_IMPL,
            resolverImpl: SepoliaENSv2.PERMISSIONED_RESOLVER_IMPL,
            saltTag: "fork-test"
        });
    }
}
