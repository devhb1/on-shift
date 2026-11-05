// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {OnShiftDeployer} from "../script/OnShiftDeployer.sol";
import {IPermissionedRegistry} from "../src/interfaces/IPermissionedRegistry.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";
import {PermissionedRegistry} from "../src/ensv2-local/PermissionedRegistry.sol";
import {PermissionedResolver} from "../src/ensv2-local/PermissionedResolver.sol";
import {RegistryRoles, ResolverRoles} from "../src/ensv2-local/Roles.sol";
import {NameHash} from "../src/ensv2-local/NameHash.sol";
import {PassIssuer} from "../src/PassIssuer.sol";
import {ShiftGate} from "../src/ShiftGate.sol";
import {IncidentSwitch} from "../src/IncidentSwitch.sol";
import {OnShiftTypes} from "../src/OnShiftTypes.sol";

contract OnShiftTest is Test, OnShiftDeployer {
    using NameHash for bytes32;

    System internal s;

    address internal org = makeAddr("org-multisig");
    address internal treasury = makeAddr("treasury");
    address internal lead = makeAddr("shift-lead");
    address internal staff = makeAddr("staff-burner");
    address internal staff2 = makeAddr("staff-burner-2");
    address internal agent = makeAddr("ai-agent");
    address internal customer = makeAddr("customer");
    address internal attacker = makeAddr("attacker");

    uint8 internal constant CASHIER = 0;
    uint8 internal constant SUPPORT = 1;
    uint8 internal constant AI_AGENT = 2;
    uint8 internal constant DOOR = 3;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.startPrank(org);
        s = _deployOnShift(org, treasury);
        s.issuer.setLead(lead, 5, true);
        s.usdc.mint(address(s.gate), 500e6);
        vm.stopPrank();
        vm.deal(lead, 10 ether);
    }

    // ---------------------------------------------------------------- helpers

    function _issue(string memory label, address holder, uint8 preset, uint64 duration, uint256 cap)
        internal
        returns (uint256 tokenId)
    {
        vm.prank(lead);
        tokenId = s.issuer.issue(label, holder, preset, duration, cap, "");
    }

    function _resolverOf(string memory label) internal view returns (PermissionedResolver) {
        return PermissionedResolver(s.ops.getResolver(label));
    }

    function _node(string memory label) internal view returns (bytes32) {
        return s.opsNode.child(label);
    }

    // ---------------------------------------------------------------- issuance

    function test_Issue_registersPassWithZeroRolesAndItsOwnResolver() public {
        uint256 tokenId = _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);

        IPermissionedRegistry.State memory st = s.ops.getState(NameHash.labelId("shift-0412"));
        assertEq(uint8(st.status), uint8(IPermissionedRegistry.Status.REGISTERED));
        assertEq(st.latestOwner, staff);
        assertEq(st.expiry, block.timestamp + 4 hours);
        assertEq(s.ops.ownerOf(tokenId), staff);
        assertEq(s.ops.roles(tokenId, staff), 0, "roleBitmap must be 0");

        PermissionedResolver r = _resolverOf("shift-0412");
        assertTrue(address(r) != address(0));
        assertTrue(address(r) != address(s.parentResolver));
        assertEq(r.addr(_node("shift-0412"), 60), abi.encodePacked(treasury));
        assertEq(r.text(_node("shift-0412"), "org"), "acme.eth");
        assertEq(r.text(_node("shift-0412"), "role"), "Cashier");

        OnShiftTypes.Scope memory scope =
            abi.decode(r.data(_node("shift-0412"), "pass.scope"), (OnShiftTypes.Scope));
        assertEq(scope.cap, 50e6);
        assertEq(scope.expiry, st.expiry);
    }

    function test_Issue_forwardsGasDrip() public {
        vm.prank(lead);
        s.issuer.issue{value: 0.01 ether}("shift-1", staff, CASHIER, 1 hours, 10e6, "");
        assertEq(staff.balance, 0.01 ether);
    }

    function test_Issue_agentPassCarriesAgentContextRecord() public {
        vm.prank(lead);
        s.issuer.issue("agent-7", agent, AI_AGENT, 1 hours, 20e6, "Refund bot for order disputes");
        assertEq(
            _resolverOf("agent-7").text(_node("agent-7"), "agent-context"), "Refund bot for order disputes"
        );
    }

    function test_Issue_guards() public {
        vm.prank(attacker);
        vm.expectRevert(PassIssuer.NotLead.selector);
        s.issuer.issue("x", staff, CASHIER, 1 hours, 1, "");

        vm.startPrank(lead);
        vm.expectRevert(PassIssuer.InvalidDuration.selector);
        s.issuer.issue("x", staff, AI_AGENT, 2 hours, 1, ""); // agent preset max = 1h

        vm.expectRevert(PassIssuer.InvalidDuration.selector);
        s.issuer.issue("x", staff, CASHIER, 10 seconds, 1, "");

        vm.expectRevert(PassIssuer.CapAboveLimit.selector);
        s.issuer.issue("x", staff, CASHIER, 1 hours, 51e6, "");

        vm.expectRevert(PassIssuer.InvalidLabel.selector);
        s.issuer.issue("Shift_1", staff, CASHIER, 1 hours, 1, "");

        vm.expectRevert(PassIssuer.InvalidLabel.selector);
        s.issuer.issue("-shift", staff, CASHIER, 1 hours, 1, "");

        vm.expectRevert(PassIssuer.InvalidPreset.selector);
        s.issuer.issue("x", staff, 9, 1 hours, 1, "");

        vm.expectRevert(PassIssuer.GasDripTooHigh.selector);
        s.issuer.issue{value: 1 ether}("x", staff, CASHIER, 1 hours, 1, "");
        vm.stopPrank();
    }

    function test_Issue_dailyBudgetIsEnforcedAndResets() public {
        for (uint256 i; i < 5; ++i) {
            _issue(string.concat("p", vm.toString(i)), staff, CASHIER, 1 hours, 1e6);
        }
        assertEq(s.issuer.remainingBudget(lead), 0);
        vm.prank(lead);
        vm.expectRevert(PassIssuer.DailyBudgetExhausted.selector);
        s.issuer.issue("p5", staff, CASHIER, 1 hours, 1e6, "");

        vm.warp(block.timestamp + 1 days);
        assertEq(s.issuer.remainingBudget(lead), 5);
        _issue("p5", staff, CASHIER, 1 hours, 1e6);
    }

    function test_Issue_cannotReissueLiveLabel() public {
        _issue("shift-1", staff, CASHIER, 1 hours, 1e6);
        vm.prank(lead);
        vm.expectRevert(
            abi.encodeWithSelector(PermissionedRegistry.NameAlreadyRegistered.selector, "shift-1")
        );
        s.issuer.issue("shift-1", attacker, CASHIER, 1 hours, 1e6, "");
    }

    // ---------------------------------------------------------------- least privilege (the "rogue cashier")

    function test_Staff_canUpdateOnlyShiftStatus() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        PermissionedResolver r = _resolverOf("shift-0412");
        bytes32 node = _node("shift-0412");

        vm.startPrank(staff);
        r.setText(node, "shift.status", "Lane 3");
        assertEq(r.text(node, "shift.status"), "Lane 3");

        vm.expectRevert(
            abi.encodeWithSelector(
                PermissionedResolver.Unauthorized.selector, ResolverRoles.ROLE_SET_ADDR, staff
            )
        );
        r.setAddr(node, 60, abi.encodePacked(attacker));

        vm.expectRevert(
            abi.encodeWithSelector(
                PermissionedResolver.Unauthorized.selector, ResolverRoles.ROLE_SET_TEXT, staff
            )
        );
        r.setText(node, "role", "Admin");

        vm.expectRevert(
            abi.encodeWithSelector(
                PermissionedResolver.Unauthorized.selector, ResolverRoles.ROLE_SET_DATA, staff
            )
        );
        r.setData(node, "pass.scope", abi.encode(type(uint256).max));
        vm.stopPrank();
    }

    function test_Staff_cannotTransferPass_evenViaApprovedOperator() public {
        uint256 tokenId = _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);

        vm.prank(staff);
        vm.expectRevert(
            abi.encodeWithSelector(PermissionedRegistry.TransferDisallowed.selector, tokenId, staff)
        );
        s.ops.safeTransferFrom(staff, attacker, tokenId, 1, "");

        // approved operators inherit the owner's roles -> with roleBitmap 0 there is nothing to inherit
        vm.prank(staff);
        s.ops.setApprovalForAll(attacker, true);
        assertEq(s.ops.roles(tokenId, attacker), 0);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(PermissionedRegistry.TransferDisallowed.selector, tokenId, staff)
        );
        s.ops.safeTransferFrom(staff, attacker, tokenId, 1, "");
    }

    function test_Staff_cannotRepointResolverOrSubregistry() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        uint256 id = NameHash.labelId("shift-0412");
        vm.startPrank(staff);
        vm.expectRevert(
            abi.encodeWithSelector(
                PermissionedRegistry.Unauthorized.selector, RegistryRoles.ROLE_SET_RESOLVER, staff
            )
        );
        s.ops.setResolver(id, attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                PermissionedRegistry.Unauthorized.selector, RegistryRoles.ROLE_SET_SUBREGISTRY, staff
            )
        );
        s.ops.setSubregistry(id, IPermissionedRegistry(attacker));
        vm.stopPrank();
    }

    /// C1: per-pass resolvers isolate passes. Staff A's setter role does not reach staff B's records.
    function test_PerPassResolver_isolatesPasses() public {
        _issue("shift-a", staff, CASHIER, 4 hours, 50e6);
        _issue("shift-b", staff2, CASHIER, 4 hours, 50e6);
        PermissionedResolver rB = _resolverOf("shift-b");

        vm.prank(staff);
        vm.expectRevert(
            abi.encodeWithSelector(
                PermissionedResolver.Unauthorized.selector, ResolverRoles.ROLE_SET_TEXT, staff
            )
        );
        rB.setText(_node("shift-b"), "shift.status", "hijacked");
    }

    /// C1, the counterfactual: this is what WOULD happen if passes shared one resolver.
    function test_SharedResolver_wouldLetStaffOverwriteEachOther() public {
        PermissionedResolver shared = PermissionedResolver(
            s.factory
                .deployProxy(
                    address(s.resolverImpl),
                    "shared",
                    abi.encodeCall(IPermissionedResolver.initialize, (address(this)))
                )
        );
        shared.grantTextSetter("shift.status", staff); // key-scoped, but NOT name-scoped
        vm.prank(staff);
        shared.setText(_node("shift-b"), "shift.status", "hijacked");
        assertEq(shared.text(_node("shift-b"), "shift.status"), "hijacked");
    }

    // ---------------------------------------------------------------- ShiftGate

    function test_Gate_refundWithinCap() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", customer, 10e6, "order-1");
        assertEq(s.usdc.balanceOf(customer), 10e6);
    }

    function test_Gate_overCapReverts() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.startPrank(staff);
        s.gate.refund("shift-0412", customer, 40e6, "order-1");
        vm.expectRevert(abi.encodeWithSelector(ShiftGate.OverCap.selector, 10e6));
        s.gate.refund("shift-0412", customer, 11e6, "order-2");
        vm.stopPrank();
    }

    function test_Gate_replayReverts() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.startPrank(staff);
        s.gate.refund("shift-0412", customer, 1e6, "order-1");
        vm.expectRevert(ShiftGate.Replay.selector);
        s.gate.refund("shift-0412", customer, 1e6, "order-1");
        vm.stopPrank();
    }

    function test_Gate_wrongHolderReverts() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(attacker);
        vm.expectRevert(ShiftGate.NotPassHolder.selector);
        s.gate.refund("shift-0412", attacker, 1e6, "order-1");
    }

    function test_Gate_actionNotInScopeReverts() public {
        _issue("door-1", staff, DOOR, 4 hours, 0);
        vm.startPrank(staff);
        s.gate.checkIn("door-1", "ticket-1");
        vm.expectRevert(ShiftGate.ActionNotAllowed.selector);
        s.gate.refund("door-1", customer, 1, "order-1");
        vm.stopPrank();
    }

    /// C2: at expiry nobody sends a transaction, yet every gated action dies.
    function test_Expiry_killsGateWithoutAnyTransaction() public {
        _issue("shift-0412", staff, CASHIER, 90 seconds, 50e6);
        PermissionedResolver r = _resolverOf("shift-0412");

        vm.warp(block.timestamp + 90 seconds);

        vm.prank(staff);
        vm.expectRevert(ShiftGate.PassNotLive.selector);
        s.gate.refund("shift-0412", customer, 1e6, "order-1");

        // registry view of an expired pass (C3 / C7)
        IPermissionedRegistry.State memory st = s.ops.getState(NameHash.labelId("shift-0412"));
        assertEq(uint8(st.status), uint8(IPermissionedRegistry.Status.AVAILABLE));
        assertEq(st.latestOwner, staff, "latestOwner ignores expiry");
        assertEq(s.ops.getResolver("shift-0412"), address(0));
        assertEq(s.ops.ownerOf(st.tokenId), address(0));

        // the honest part: the staff's resolver role survives expiry, the write still succeeds,
        // but it is INERT because the registry no longer points at this resolver.
        vm.prank(staff);
        r.setText(_node("shift-0412"), "shift.status", "still here?");
        assertFalse(s.gate.passStatus("shift-0412").live);
    }

    function test_RevokeNow_byIssuingLeadOrOrgOnly() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);

        vm.prank(attacker);
        vm.expectRevert(PassIssuer.NotAuthorizedToRevoke.selector);
        s.issuer.revokeNow("shift-0412");

        vm.prank(lead);
        s.issuer.revokeNow("shift-0412");

        vm.prank(staff);
        vm.expectRevert(ShiftGate.PassNotLive.selector);
        s.gate.refund("shift-0412", customer, 1e6, "order-1");

        _issue("shift-0413", staff, CASHIER, 4 hours, 50e6);
        vm.prank(org);
        s.issuer.revokeNow("shift-0413");
        assertFalse(s.gate.passStatus("shift-0413").live);
    }

    /// C5: renew() revives old owner + roles. PassIssuer can't renew; and even if the org multisig does,
    ///     the gate refuses because the scope record was bound to the old expiry.
    function test_Renew_issuerHasNoRole_andGateRefusesRevivedPass() public {
        _issue("shift-0412", staff, CASHIER, 90 seconds, 50e6);
        uint256 id = NameHash.labelId("shift-0412");
        assertFalse(s.ops.hasRootRoles(RegistryRoles.ROLE_RENEW, address(s.issuer)));

        vm.warp(block.timestamp + 2 minutes);
        vm.prank(org);
        s.ops.renew(id, uint64(block.timestamp + 1 hours));
        assertEq(uint8(s.ops.getState(id).status), uint8(IPermissionedRegistry.Status.REGISTERED));

        vm.prank(staff);
        vm.expectRevert(ShiftGate.ScopeMismatch.selector);
        s.gate.refund("shift-0412", customer, 1e6, "order-1");
    }

    /// C7: token IDs change on re-registration; spend is tracked per registration, keyed by labelhash.
    function test_Reissue_newTokenIdAndFreshSpend() public {
        uint256 t1 = _issue("shift-0412", staff, CASHIER, 90 seconds, 10e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", customer, 10e6, "o-1");

        vm.warp(block.timestamp + 91 seconds);
        uint256 t2 = _issue("shift-0412", staff2, CASHIER, 1 hours, 10e6);
        assertTrue(t1 != t2);
        assertEq(s.ops.ownerOf(t1), address(0));

        vm.prank(staff); // the old holder is not the holder any more
        vm.expectRevert(ShiftGate.NotPassHolder.selector);
        s.gate.refund("shift-0412", customer, 1e6, "o-2");

        vm.prank(staff2);
        s.gate.refund("shift-0412", customer, 10e6, "o-3");
    }

    // ---------------------------------------------------------------- break-glass

    function test_BreakGlass_killsEveryPassInOneTransaction() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(lead);
        s.issuer.issue("agent-7", agent, AI_AGENT, 1 hours, 20e6, "refund bot");

        vm.prank(attacker);
        vm.expectRevert(IncidentSwitch.NotOrg.selector);
        s.incidentSwitch.breakGlass("nope");

        vm.prank(org);
        s.incidentSwitch.breakGlass("Support desk phishing wave");

        vm.prank(staff);
        vm.expectRevert(ShiftGate.PassNotLive.selector);
        s.gate.refund("shift-0412", customer, 1e6, "o-1");
        vm.prank(agent);
        vm.expectRevert(ShiftGate.PassNotLive.selector);
        s.gate.refund("agent-7", customer, 1e6, "o-2");

        assertEq(s.parentResolver.text(s.orgNode, "ops.status"), "incident");
        assertEq(s.parentResolver.text(s.orgNode, "ops.incident"), "Support desk phishing wave");

        vm.prank(lead);
        vm.expectRevert(PassIssuer.NamespaceFrozen.selector);
        s.issuer.issue("shift-9", staff, CASHIER, 1 hours, 1e6, "");
    }

    function test_Restore_freshNamespace_oldPassesStayDead() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.startPrank(org);
        s.incidentSwitch.breakGlass("incident");
        address fresh = s.incidentSwitch.restore();
        vm.stopPrank();

        assertTrue(fresh != address(s.ops));
        assertEq(address(s.parent.getSubregistry("ops")), fresh);
        assertEq(s.parentResolver.text(s.orgNode, "ops.status"), "ok");

        vm.prank(staff);
        vm.expectRevert(ShiftGate.PassNotLive.selector);
        s.gate.refund("shift-0412", customer, 1e6, "o-1");

        // issuance works again, into the new namespace
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", customer, 1e6, "o-1");
    }

    function test_IncidentSwitch_holdsOnlyKeyScopedTextRights() public {
        // the switch can write the two incident keys and nothing else on the org resolver (C8)
        vm.prank(address(s.incidentSwitch));
        vm.expectRevert(
            abi.encodeWithSelector(
                PermissionedResolver.Unauthorized.selector,
                ResolverRoles.ROLE_SET_TEXT,
                address(s.incidentSwitch)
            )
        );
        s.parentResolver.setText(s.orgNode, "url", "https://phish.example");
    }

    // ---------------------------------------------------------------- views

    function test_PassStatus_view() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", customer, 7e6, "o-1");

        ShiftGate.PassStatus memory p = s.gate.passStatus("shift-0412");
        assertTrue(p.live);
        assertEq(p.latestOwner, staff);
        assertEq(p.cap, 50e6);
        assertEq(p.spent, 7e6);
        assertEq(p.shiftStatus, "Starting shift");
        assertEq(p.actions, OnShiftTypes.ACTION_REFUND | OnShiftTypes.ACTION_CHECK_IN);

        assertFalse(s.gate.passStatus("never-issued").live);
    }

    // ---------------------------------------------------------------- fuzz

    /// The total paid out during one pass can never exceed its cap, whatever the request sequence.
    function testFuzz_spendNeverExceedsCap(uint64 cap, uint64[6] memory amounts) public {
        cap = uint64(bound(cap, 0, 50e6));
        _issue("shift-fuzz", staff, CASHIER, 4 hours, cap);
        uint256 paid;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 amount = bound(amounts[i], 0, 60e6);
            vm.prank(staff);
            try s.gate.refund("shift-fuzz", customer, amount, bytes32(i + 1)) {
                paid += amount;
            } catch {}
        }
        assertLe(paid, cap);
        assertEq(s.usdc.balanceOf(customer), paid);
    }
}
