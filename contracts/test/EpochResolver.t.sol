// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EpochResolver} from "../src/EpochResolver.sol";
import {ResolverRoles} from "../src/ensv2-local/Roles.sol";
import {NameHash} from "../src/ensv2-local/NameHash.sol";

/// @notice Proves the cheap shared-resolver path kills a previous holder's grant on re-issue.
///         Production cashiers still use a Permissioned Resolver per pass until the full C1–C8 suite
///         is ported onto this path.
contract EpochResolverTest is Test {
    EpochResolver internal r;
    address internal issuer = makeAddr("issuer");
    address internal holder1 = makeAddr("holder-1");
    address internal holder2 = makeAddr("holder-2");
    bytes32 internal node;

    function setUp() public {
        r = new EpochResolver(issuer);
        node = NameHash.namehash(NameHash.dnsEncode("shift-1.ops.onshift.eth"));
    }

    function test_Reissue_burnsPreviousHolderGrant() public {
        vm.startPrank(issuer);
        r.bumpEpoch(node);
        r.authorizeTextRoles(node, "shift.status", holder1, true);
        vm.stopPrank();

        vm.prank(holder1);
        r.setText(node, "shift.status", "lane 1");
        assertEq(r.text(node, "shift.status"), "lane 1");

        // Re-issue the same namehash: bump epoch, grant the new holder.
        vm.startPrank(issuer);
        r.bumpEpoch(node);
        r.authorizeTextRoles(node, "shift.status", holder2, true);
        vm.stopPrank();

        vm.expectRevert(
            abi.encodeWithSelector(
                EpochResolver.EACUnauthorizedAccountRoles.selector,
                r.resource(node, 2, keccak256("shift.status")),
                ResolverRoles.ROLE_SET_TEXT,
                holder1
            )
        );
        vm.prank(holder1);
        r.setText(node, "shift.status", "still me");

        vm.prank(holder2);
        r.setText(node, "shift.status", "lane 2");
        assertEq(r.text(node, "shift.status"), "lane 2");
    }
}
