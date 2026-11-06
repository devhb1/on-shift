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
import {Playground} from "../src/Playground.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";
import {OnShiftTypes} from "../src/OnShiftTypes.sol";

/// @notice The registry surface the tests poke at directly (ERC1155 + EAC), identical on the local layer
///         and on the real ENSv2 UserRegistry.
interface ITestRegistry {
    function roles(uint256 anyId, address account) external view returns (uint256);
    function setApprovalForAll(address operator, bool approved) external;
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data)
        external;
}

/// @notice One suite, two runners: OnShiftLocalTest (local ENSv2 layer) and SepoliaForkTest
///         (the real ENSv2 contracts on a Sepolia fork).
abstract contract OnShiftSuite is Test, OnShiftDeployer {
    using NameHash for bytes32;

    System internal s;
    IPermissionedRegistry internal ops;
    MockUSDC internal usdc;

    uint256 internal constant ISSUER_ROLES = ResolverRoles.RECORDS | (ResolverRoles.RECORDS << 128);

    /// @dev The ENSv2 contracts to build on.
    function _infra() internal virtual returns (Infra memory);

    address internal org = makeAddr("org-multisig");
    address internal treasury = makeAddr("treasury");
    address internal lead = makeAddr("shift-lead");
    address internal staff = makeAddr("staff-burner");
    address internal staff2 = makeAddr("staff-burner-2");
    address internal agent = makeAddr("ai-agent");
    address internal customer = makeAddr("customer");
    address internal attacker = makeAddr("attacker");
    address internal watchtower = makeAddr("watchtower");
    address internal auditor = makeAddr("auditor");

    uint8 internal constant CASHIER = 0;
    uint8 internal constant SUPPORT = 1;
    uint8 internal constant AI_AGENT = 2;
    uint8 internal constant DOOR = 3;

    function setUp() public virtual {
        if (block.timestamp < 1_800_000_000) vm.warp(1_800_000_000);
        Infra memory infra = _infra();
        vm.startPrank(org);
        usdc = new MockUSDC();
        s = _deployOnShift(org, treasury, IERC20(address(usdc)), infra, "onshift.eth");
        ops = s.ops;
        s.issuer.setLead(lead, 5, true);
        s.incidentSwitch.setWatchtower(watchtower);
        s.incidentSwitch.setAuditor(auditor);
        usdc.mint(address(s.gate), 500e6);
        vm.stopPrank();
        vm.deal(lead, 10 ether);
        order = _pay(customer, 100e6);
    }

    /// @dev A $100 order paid by `customer`, the one most refund tests draw on.
    bytes32 internal order;

    // ---------------------------------------------------------------- helpers

    function _pay(address payer, uint256 amount) internal returns (bytes32 orderId) {
        usdc.mint(payer, amount);
        vm.startPrank(payer);
        usdc.approve(address(s.gate), amount);
        orderId = s.gate.pay(amount);
        vm.stopPrank();
    }

    function _issue(string memory label, address holder, uint8 preset, uint64 duration, uint256 cap)
        internal
        returns (uint256 tokenId)
    {
        vm.prank(lead);
        tokenId = s.issuer.issue(label, holder, preset, duration, cap, "");
    }

    function _resolverOf(string memory label) internal view returns (IPermissionedResolver) {
        return IPermissionedResolver(ops.getResolver(label));
    }

    function _node(string memory label) internal view returns (bytes32) {
        return s.opsNode.child(label);
    }

    // ---------------------------------------------------------------- issuance

    function test_Issue_registersPassWithZeroRolesAndItsOwnResolver() public {
        uint256 tokenId = _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);

        IPermissionedRegistry.State memory st = ops.getState(NameHash.labelId("shift-0412"));
        assertEq(uint8(st.status), uint8(IPermissionedRegistry.Status.REGISTERED));
        assertEq(st.latestOwner, staff);
        assertEq(st.expiry, block.timestamp + 4 hours);
        assertEq(ops.ownerOf(tokenId), staff);
        assertEq(ITestRegistry(address(ops)).roles(tokenId, staff), 0, "roleBitmap must be 0");

        IPermissionedResolver r = _resolverOf("shift-0412");
        assertTrue(address(r) != address(0));
        assertTrue(address(r) != address(s.parentResolver));
        assertEq(r.addr(_node("shift-0412"), 60), abi.encodePacked(treasury));
        assertEq(r.text(_node("shift-0412"), "org"), "onshift.eth");
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
        assertEq(s.issuer.issuedOnDay(lead, vm.getBlockTimestamp() / 1 days), 5);
        vm.prank(lead);
        vm.expectRevert(PassIssuer.DailyBudgetExhausted.selector);
        s.issuer.issue("p5", staff, CASHIER, 1 hours, 1e6, "");

        vm.warp(block.timestamp + 1 days);
        assertEq(s.issuer.issuedOnDay(lead, vm.getBlockTimestamp() / 1 days), 0);
        _issue("p5", staff, CASHIER, 1 hours, 1e6);
    }

    function test_Issue_cannotReissueLiveLabel() public {
        _issue("shift-1", staff, CASHIER, 1 hours, 1e6);
        vm.prank(lead);
        vm.expectRevert(
            abi.encodeWithSelector(PermissionedRegistry.LabelAlreadyRegistered.selector, "shift-1")
        );
        s.issuer.issue("shift-1", attacker, CASHIER, 1 hours, 1e6, "");
    }

    // ---------------------------------------------------------------- least privilege (the "rogue cashier")

    function test_Staff_canUpdateOnlyShiftStatus() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        IPermissionedResolver r = _resolverOf("shift-0412");
        bytes32 node = _node("shift-0412");

        vm.startPrank(staff);
        r.setText(node, "shift.status", "Lane 3");
        assertEq(r.text(node, "shift.status"), "Lane 3");

        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        r.setAddr(node, 60, abi.encodePacked(attacker));

        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        r.setText(node, "role", "Admin");

        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        r.setData(node, "pass.scope", abi.encode(type(uint256).max));
        vm.stopPrank();
    }

    function test_Staff_cannotTransferPass_evenViaApprovedOperator() public {
        uint256 tokenId = _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);

        vm.prank(staff);
        vm.expectRevert(
            abi.encodeWithSelector(PermissionedRegistry.TransferDisallowed.selector, tokenId, staff)
        );
        ITestRegistry(address(ops)).safeTransferFrom(staff, attacker, tokenId, 1, "");

        // approved operators inherit the owner's roles -> with roleBitmap 0 there is nothing to inherit
        vm.prank(staff);
        ITestRegistry(address(ops)).setApprovalForAll(attacker, true);
        assertEq(ITestRegistry(address(ops)).roles(tokenId, attacker), 0);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(PermissionedRegistry.TransferDisallowed.selector, tokenId, staff)
        );
        ITestRegistry(address(ops)).safeTransferFrom(staff, attacker, tokenId, 1, "");
    }

    function test_Staff_cannotRepointResolverOrSubregistry() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        uint256 id = NameHash.labelId("shift-0412");
        vm.startPrank(staff);
        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        ops.setResolver(id, attacker);
        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        ops.setSubregistry(id, IPermissionedRegistry(attacker));
        vm.stopPrank();
    }

    /// C1: per-pass resolvers isolate passes. Staff A's setter role does not reach staff B's records.
    function test_PerPassResolver_isolatesPasses() public {
        _issue("shift-a", staff, CASHIER, 4 hours, 50e6);
        _issue("shift-b", staff2, CASHIER, 4 hours, 50e6);
        IPermissionedResolver rB = _resolverOf("shift-b");

        vm.prank(staff);
        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        rB.setText(_node("shift-b"), "shift.status", "hijacked");
    }

    /// C1, the counterfactual. The current ENSv2 resolver CAN scope a grant to one record of one name,
    /// but grants are keyed by namehash, and a re-issued label has the same namehash. On a shared
    /// resolver the previous holder's grant would survive into the next holder's pass. Per-pass
    /// resolvers make that impossible: the new pass gets a fresh instance with no old grants.
    function test_SharedResolver_perNameGrantSurvivesReissue() public {
        IPermissionedResolver shared = IPermissionedResolver(
            s.infra.factory
                .deployProxy(
                    s.infra.resolverImpl,
                    uint256(keccak256("shared")),
                    abi.encodeCall(
                        IPermissionedResolver.initialize, (address(this), ISSUER_ROLES, new bytes[](0))
                    )
                )
        );
        bytes memory name = NameHash.dnsEncode("shift-1.ops.onshift.eth");
        shared.authorizeTextRoles(name, "shift.status", staff, true);

        // shift ends; the same label is issued to someone else
        _issue("shift-1", staff, CASHIER, 90 seconds, 1e6);
        vm.warp(block.timestamp + 2 minutes);
        _issue("shift-1", staff2, CASHIER, 1 hours, 1e6);

        // shared resolver: the OLD holder can still write the NEW holder's status
        vm.prank(staff);
        shared.setText(_node("shift-1"), "shift.status", "hijacked");
        assertEq(shared.text(_node("shift-1"), "shift.status"), "hijacked");

        // per-pass resolver (what OnShift does): the old holder has no grant on the new instance
        IPermissionedResolver fresh = _resolverOf("shift-1");
        vm.prank(staff);
        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        fresh.setText(_node("shift-1"), "shift.status", "hijacked");
    }

    // ---------------------------------------------------------------- ShiftGate

    function test_Gate_refundWithinCap() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", order, 10e6);
        assertEq(usdc.balanceOf(customer), 10e6);
        assertEq(s.gate.refundable(order), 90e6);
    }

    /// The pass holder never names the recipient: money only goes back to the wallet that paid.
    function test_Gate_refundGoesOnlyToThePayer() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        uint256 staffBefore = usdc.balanceOf(staff);
        vm.prank(staff);
        s.gate.refund("shift-0412", order, 50e6);
        assertEq(usdc.balanceOf(customer), 50e6);
        assertEq(usdc.balanceOf(staff), staffBefore);
    }

    /// A cashier who wants the float has to pay it in first, so self-dealing nets to zero.
    function test_Gate_selfDealingNetsToZero() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        bytes32 own = _pay(attacker, 20e6);
        uint256 gateBefore = usdc.balanceOf(address(s.gate));
        vm.prank(staff);
        s.gate.refund("shift-0412", own, 20e6);
        assertEq(usdc.balanceOf(attacker), 20e6);
        assertEq(usdc.balanceOf(address(s.gate)), gateBefore - 20e6);
        assertEq(gateBefore - 20e6, 500e6 + 100e6, "the float is untouched");
    }

    function test_Gate_unknownOrderReverts() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(staff);
        vm.expectRevert(ShiftGate.UnknownOrder.selector);
        s.gate.refund("shift-0412", keccak256("made-up"), 1e6);
    }

    function test_Pay_orderIdsAreUniquePerPayer() public {
        bytes32 a = _pay(customer, 1e6);
        bytes32 b = _pay(customer, 1e6);
        bytes32 c = _pay(attacker, 1e6);
        assertTrue(a != b && a != c && b != c && a != order);
        (address payer, uint128 paid, uint128 refunded) = s.gate.orders(a);
        assertEq(payer, customer);
        assertEq(paid, 1e6);
        assertEq(refunded, 0);

        vm.prank(customer);
        vm.expectRevert(ShiftGate.InvalidAmount.selector);
        s.gate.pay(0);
    }

    function test_Gate_overCapReverts() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.startPrank(staff);
        s.gate.refund("shift-0412", order, 40e6);
        vm.expectRevert(abi.encodeWithSelector(ShiftGate.OverCap.selector, 10e6));
        s.gate.refund("shift-0412", order, 11e6);
        vm.stopPrank();
    }

    /// Partial refunds add up to the order and no further, across passes.
    function test_Gate_cannotRefundMoreThanPaid() public {
        bytes32 small = _pay(customer, 5e6);
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        _issue("shift-0413", staff2, CASHIER, 4 hours, 50e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", small, 3e6);
        vm.prank(staff2);
        vm.expectRevert(abi.encodeWithSelector(ShiftGate.OverRefund.selector, 2e6));
        s.gate.refund("shift-0413", small, 3e6);
        vm.prank(staff2);
        s.gate.refund("shift-0413", small, 2e6);
        assertEq(s.gate.refundable(small), 0);
    }

    function test_Gate_wrongHolderReverts() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(attacker);
        vm.expectRevert(ShiftGate.NotPassHolder.selector);
        s.gate.refund("shift-0412", order, 1e6);
    }

    function test_Gate_actionNotInScopeReverts() public {
        _issue("door-1", staff, DOOR, 4 hours, 0);
        vm.startPrank(staff);
        s.gate.checkIn("door-1", "ticket-1");
        vm.expectRevert(ShiftGate.ActionNotAllowed.selector);
        s.gate.refund("door-1", order, 1);
        vm.stopPrank();
    }

    /// C2: at expiry nobody sends a transaction, yet every gated action dies.
    function test_Expiry_killsGateWithoutAnyTransaction() public {
        _issue("shift-0412", staff, CASHIER, 90 seconds, 50e6);
        IPermissionedResolver r = _resolverOf("shift-0412");

        vm.warp(block.timestamp + 90 seconds);

        vm.prank(staff);
        vm.expectRevert(ShiftGate.PassNotLive.selector);
        s.gate.refund("shift-0412", order, 1e6);

        // registry view of an expired pass (C3 / C7)
        IPermissionedRegistry.State memory st = ops.getState(NameHash.labelId("shift-0412"));
        assertEq(uint8(st.status), uint8(IPermissionedRegistry.Status.AVAILABLE));
        assertEq(st.latestOwner, staff, "latestOwner ignores expiry");
        assertEq(ops.getResolver("shift-0412"), address(0));
        assertEq(ops.ownerOf(st.tokenId), address(0));

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
        s.gate.refund("shift-0412", order, 1e6);

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
        assertFalse(ops.hasRootRoles(RegistryRoles.ROLE_RENEW, address(s.issuer)));

        vm.warp(block.timestamp + 2 minutes);
        vm.prank(org);
        ops.renew(id, uint64(block.timestamp + 1 hours));
        assertEq(uint8(ops.getState(id).status), uint8(IPermissionedRegistry.Status.REGISTERED));

        vm.prank(staff);
        vm.expectRevert(ShiftGate.ScopeMismatch.selector);
        s.gate.refund("shift-0412", order, 1e6);
    }

    /// C7: token IDs change on re-registration; spend is tracked per registration, keyed by labelhash.
    function test_Reissue_newTokenIdAndFreshSpend() public {
        uint256 t1 = _issue("shift-0412", staff, CASHIER, 90 seconds, 10e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", order, 10e6);

        vm.warp(block.timestamp + 91 seconds);
        uint256 t2 = _issue("shift-0412", staff2, CASHIER, 1 hours, 10e6);
        assertTrue(t1 != t2);
        assertEq(ops.ownerOf(t1), address(0));

        vm.prank(staff); // the old holder is not the holder any more
        vm.expectRevert(ShiftGate.NotPassHolder.selector);
        s.gate.refund("shift-0412", order, 1e6);

        vm.prank(staff2);
        s.gate.refund("shift-0412", order, 10e6);
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
        s.gate.refund("shift-0412", order, 1e6);
        vm.prank(agent);
        vm.expectRevert(ShiftGate.PassNotLive.selector);
        s.gate.refund("agent-7", order, 1e6);

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
        s.gate.refund("shift-0412", order, 1e6);

        // issuance works again, into the new namespace
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", order, 1e6);
    }

    function test_IncidentSwitch_holdsOnlyKeyScopedTextRights() public {
        // the switch can write the two incident keys and nothing else on the org resolver (C8)
        vm.prank(address(s.incidentSwitch));
        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        s.parentResolver.setText(s.orgNode, "url", "https://phish.example");
    }

    function test_Alias_flipStopsPayKeepsPayerRefund() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        assertTrue(s.gate.tillLive());
        assertEq(s.parentResolver.text(s.orgNode.child("till"), "till.status"), "live");
        assertEq(s.parentResolver.addr(s.orgNode.child("till"), 60), abi.encodePacked(address(s.gate)));

        vm.prank(attacker);
        vm.expectRevert(IncidentSwitch.NotWatchtower.selector);
        s.incidentSwitch.quarantineTill();

        vm.prank(watchtower);
        s.incidentSwitch.quarantineTill();

        assertFalse(s.gate.tillLive());
        assertEq(s.parentResolver.text(s.orgNode.child("till"), "till.status"), "quarantine");
        // quarantine.<org> publishes no address, and addr() follows the alias
        assertEq(s.parentResolver.addr(s.orgNode.child("till"), 60).length, 0);
        // resolver-level alias: till.<org> now serves quarantine.<org>'s records
        assertEq(
            keccak256(s.parentResolver.getAlias(NameHash.dnsEncode("till.onshift.eth"))),
            keccak256(NameHash.dnsEncode("quarantine.onshift.eth"))
        );

        vm.prank(customer);
        usdc.approve(address(s.gate), 1e6);
        vm.prank(customer);
        vm.expectRevert(ShiftGate.TillNotLive.selector);
        s.gate.pay(1e6);

        // already-paid orders still refund to the original payer
        uint256 before = usdc.balanceOf(customer);
        vm.prank(staff);
        s.gate.refund("shift-0412", order, 10e6);
        assertEq(usdc.balanceOf(customer), before + 10e6);
    }

    function test_Watchtower_cannotAliasToAttacker() public {
        // watchtower has no resolver roles of its own; it can only call quarantineTill, whose
        // target DNS is fixed at deploy. A raw setAlias from the watchtower reverts.
        vm.prank(watchtower);
        vm.expectPartialRevert(PermissionedResolver.EACUnauthorizedAccountRoles.selector);
        s.parentResolver.setAlias(
            NameHash.dnsEncode("till.onshift.eth"), NameHash.dnsEncode("attacker.onshift.eth")
        );
    }

    function test_Promote_requiresAuditorAndMatchingCodehash() public {
        vm.prank(watchtower);
        s.incidentSwitch.quarantineTill();

        vm.prank(org);
        vm.expectRevert(IncidentSwitch.AuditorNotApproved.selector);
        s.incidentSwitch.promote();

        vm.prank(attacker);
        vm.expectRevert(IncidentSwitch.NotAuditor.selector);
        s.incidentSwitch.approvePromote();

        vm.prank(auditor);
        s.incidentSwitch.approvePromote();
        vm.prank(org);
        s.incidentSwitch.promote();

        assertTrue(s.gate.tillLive());
        usdc.mint(customer, 1e6);
        vm.startPrank(customer);
        usdc.approve(address(s.gate), 1e6);
        s.gate.pay(1e6);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- playground

    function _playground() internal returns (Playground pg) {
        pg = new Playground(s.issuer);
        vm.prank(org);
        s.issuer.setLead(address(pg), 100, true);
    }

    function test_Playground_anyoneIssuesARealPass() public {
        Playground pg = _playground();
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        string memory label = pg.tryIt{value: 0.01 ether}(staff, CASHIER, 1 hours, 5e6, "");
        assertEq(label, "play-1");
        assertEq(staff.balance, 0.01 ether);

        // the same ENSv2 guarantees as an org pass
        uint256 id = NameHash.labelId(label);
        assertEq(ops.getState(id).latestOwner, staff);
        assertEq(ITestRegistry(address(ops)).roles(id, staff), 0);
        assertTrue(s.gate.passStatus(label).live);

        vm.prank(staff);
        s.gate.refund(label, order, 5e6);
        vm.prank(staff);
        vm.expectRevert(abi.encodeWithSelector(ShiftGate.OverCap.selector, 0));
        s.gate.refund(label, order, 1);
    }

    function test_Playground_limits() public {
        Playground pg = _playground();
        vm.startPrank(attacker);
        vm.expectRevert(Playground.CapTooHigh.selector);
        pg.tryIt(staff, CASHIER, 1 hours, 5e6 + 1, "");
        vm.expectRevert(Playground.DurationTooLong.selector);
        pg.tryIt(staff, CASHIER, 1 hours + 1, 1e6, "");
        for (uint256 i; i < 3; ++i) {
            pg.tryIt(staff, CASHIER, 1 hours, 1e6, "");
        }
        vm.expectRevert(Playground.TooManyToday.selector);
        pg.tryIt(staff, CASHIER, 1 hours, 1e6, "");
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        vm.prank(attacker);
        assertEq(pg.tryIt(staff, CASHIER, 1 hours, 1e6, ""), "play-4");
    }

    function test_Playground_onlyRequesterRevokes() public {
        Playground pg = _playground();
        vm.prank(attacker);
        string memory label = pg.tryIt(staff, CASHIER, 1 hours, 1e6, "");

        vm.prank(customer);
        vm.expectRevert(Playground.NotRequester.selector);
        pg.revoke(label);

        vm.prank(attacker);
        pg.revoke(label);
        assertFalse(s.gate.passStatus(label).live);
    }

    function test_Playground_stopsWhenTheOrgSaysSo() public {
        Playground pg = _playground();
        vm.prank(org);
        s.issuer.setLead(address(pg), 0, false);
        vm.prank(attacker);
        vm.expectRevert(PassIssuer.NotLead.selector);
        pg.tryIt(staff, CASHIER, 1 hours, 1e6, "");
    }

    // ---------------------------------------------------------------- views

    function test_PassStatus_view() public {
        _issue("shift-0412", staff, CASHIER, 4 hours, 50e6);
        vm.prank(staff);
        s.gate.refund("shift-0412", order, 7e6);

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
            try s.gate.refund("shift-fuzz", order, amount) {
                paid += amount;
            } catch {}
        }
        assertLe(paid, cap);
        assertEq(usdc.balanceOf(customer), paid);
    }

    /// Two passes refunding the same order can never return more than the customer paid.
    function testFuzz_refundsNeverExceedPayment(uint64 price, uint64[6] memory amounts) public {
        price = uint64(bound(price, 1, 60e6));
        bytes32 o = _pay(attacker, price);
        _issue("shift-a", staff, CASHIER, 4 hours, 50e6);
        _issue("shift-b", staff2, CASHIER, 4 hours, 50e6);
        uint256 back;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 amount = bound(amounts[i], 0, 40e6);
            address who = i % 2 == 0 ? staff : staff2;
            vm.prank(who);
            try s.gate.refund(i % 2 == 0 ? "shift-a" : "shift-b", o, amount) {
                back += amount;
            } catch {}
        }
        assertLe(back, price);
        assertEq(usdc.balanceOf(attacker), back);
        assertEq(s.gate.refundable(o), price - back);
    }
}

contract OnShiftLocalTest is OnShiftSuite {
    function _infra() internal override returns (Infra memory) {
        return _deployLocalInfra();
    }
}
