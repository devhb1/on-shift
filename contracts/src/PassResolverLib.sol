// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {IVerifiableFactory} from "./interfaces/IVerifiableFactory.sol";
import {ResolverRoles} from "./ensv2-local/Roles.sol";
import {OnShiftTypes} from "./OnShiftTypes.sol";

/// @title PassResolverLib
/// @notice Deploys and fills the resolver that serves exactly one pass. An external library, so it runs by
///         DELEGATECALL in PassIssuer's context (PassIssuer stays the resolver admin) while keeping
///         PassIssuer's own bytecode small enough to deploy under Sepolia's per-transaction gas cap.
library PassResolverLib {
    /// @dev Roles PassIssuer takes on each pass resolver: write records, grant them, and grant upgrade to the
    ///      org (it never holds ROLE_UPGRADE itself).
    uint256 internal constant ISSUER_ROLES =
        ResolverRoles.RECORDS | (ResolverRoles.RECORDS << 128) | (ResolverRoles.ROLE_UPGRADE << 128);
    uint256 internal constant ORG_ROLES = (ResolverRoles.RECORDS | ResolverRoles.ROLE_UPGRADE)
        | ((ResolverRoles.RECORDS | ResolverRoles.ROLE_UPGRADE) << 128);

    struct Setup {
        IVerifiableFactory factory;
        address implementation;
        uint256 salt;
        bytes32 node;
        bytes dnsName; // DNS-encoded full pass name, for the per-name holder grant
        address treasury;
        address org;
        address holder;
        string orgName;
        string roleName;
        string agentContext; // empty unless an agent pass
        OnShiftTypes.Scope scope;
    }

    function deploy(Setup memory s) external returns (address resolver) {
        resolver = s.factory
            .deployProxy(
                s.implementation,
                s.salt,
                abi.encodeCall(
                    IPermissionedResolver.initialize, (address(this), ISSUER_ROLES, new bytes[](0))
                )
            );
        IPermissionedResolver r = IPermissionedResolver(resolver);

        // issuer-only records
        r.setAddr(s.node, OnShiftTypes.COIN_TYPE_ETH, abi.encodePacked(s.treasury));
        r.setData(s.node, OnShiftTypes.KEY_SCOPE, abi.encode(s.scope));
        r.setText(s.node, OnShiftTypes.KEY_ORG, s.orgName);
        r.setText(s.node, OnShiftTypes.KEY_ROLE, s.roleName);
        r.setText(s.node, OnShiftTypes.KEY_STATUS, "Starting shift");
        if (bytes(s.agentContext).length > 0) {
            r.setText(s.node, OnShiftTypes.KEY_AGENT_CONTEXT, s.agentContext);
        }

        // the holder may write exactly one record of exactly this name, and nothing else
        r.authorizeTextRoles(s.dnsName, OnShiftTypes.KEY_STATUS, s.holder, true);
        // the org multisig keeps admin (and ROLE_UPGRADE) over every pass resolver
        r.grantRootRoles(ORG_ROLES, s.org);
    }
}
