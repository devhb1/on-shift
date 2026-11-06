// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {OnShiftLocalTest} from "./OnShift.t.sol";
import {Playground} from "../src/Playground.sol";
import {ShiftGate} from "../src/ShiftGate.sol";
import {PassIssuer} from "../src/PassIssuer.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";
import {IPermissionedRegistry} from "../src/interfaces/IPermissionedRegistry.sol";
import {NameHash} from "../src/ensv2-local/NameHash.sol";

/// @notice Inverted regressions for the Phase-0 sandbox findings (F-03…F-11 / PoC F01–F05).
///         Each test PASSES when the weakness is gone.
contract AuditFindingsTest is OnShiftLocalTest {
    // F-01 / F01: Playground must not mint a live ops Cashier under onshift.eth.
    function test_F01_PlaygroundPassIsDemoNotRealCashier() public {
        Playground pg = _playground();
        address scammer = makeAddr("scammer");
        vm.prank(scammer);
        string memory label = pg.tryIt(scammer, DEMO_CASHIER, 1 hours, 0);
        assertFalse(s.gate.passStatus(label).live, "must not be live on production gate");
        assertTrue(s.sandboxGate.passStatus(label).live, "live only on sandbox gate");
        IPermissionedResolver r = _demoResolverOf(label);
        assertEq(r.text(_demoNode(label), "role"), "Demo cashier");
        assertEq(r.text(_demoNode(label), "org"), "onshift.eth");
        assertEq(uint8(ops.getState(NameHash.labelId(label)).status), uint8(IPermissionedRegistry.Status.AVAILABLE));
    }

    // F-02 / F02: agent-context on demo passes is forced empty.
    function test_F02_PlaygroundAgentContextForcedEmpty() public {
        Playground pg = _playground();
        vm.prank(attacker);
        string memory label = pg.tryIt(attacker, DEMO_AGENT, 1 hours, 0);
        assertEq(_demoResolverOf(label).text(_demoNode(label), "agent-context"), "");
        assertEq(_demoResolverOf(label).text(_demoNode(label), "role"), "Demo agent");
    }

    // F-03 / F03: demo passes cannot refund production orders.
    function test_F03_PlaygroundCannotRefundProductionOrder() public {
        Playground pg = _playground();
        uint256 before = usdc.balanceOf(customer);
        vm.prank(attacker);
        string memory label = pg.tryIt(attacker, DEMO_CASHIER, 1 hours, 5e6);
        vm.prank(attacker);
        vm.expectRevert(ShiftGate.PassNotLive.selector);
        s.gate.refund(label, order, 5e6);
        assertEq(usdc.balanceOf(customer), before);
    }

    // F-04 / F04: sybil spam cannot lock judges out via shared lead budget.
    function test_F04_PlaygroundSurvivesSybilSpam() public {
        Playground pg = _playground();
        for (uint256 i; i < 40; ++i) {
            address sybil = address(uint160(0x5000 + i));
            vm.startPrank(sybil);
            for (uint256 j; j < 3; ++j) {
                pg.tryIt(sybil, DEMO_CASHIER, 1 hours, 0);
            }
            vm.stopPrank();
        }
        address judge = makeAddr("judge");
        vm.prank(judge);
        string memory label = pg.tryIt(judge, DEMO_CASHIER, 1 hours, 1e6);
        assertTrue(s.sandboxGate.passStatus(label).live);
    }

    // F-05 / F05: leads cannot squat play- on ops; Playground still mints on demo.
    function test_F05_LeadCannotSquatPlayLabelOnOps() public {
        Playground pg = _playground();
        vm.prank(lead);
        vm.expectRevert(PassIssuer.PlayLabelReserved.selector);
        s.issuer.issue("play-1", staff, DOOR, 12 hours, 0, "");
        vm.prank(attacker);
        string memory label = pg.tryIt(attacker, DEMO_CASHIER, 1 hours, 1e6);
        assertTrue(s.sandboxGate.passStatus(label).live);
    }
}
