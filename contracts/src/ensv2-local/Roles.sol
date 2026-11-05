// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Role bits used by the local ENSv2 layer. ENSv2 Enhanced Access Control packs roles into a
///         bitmap (one nybble per role, admin counterparts in the high half). We keep the same shape:
///         one bit per role, documented names identical to the ENSv2 docs.
library RegistryRoles {
    uint256 internal constant ROLE_REGISTRAR = 1 << 0;
    uint256 internal constant ROLE_RENEW = 1 << 4;
    uint256 internal constant ROLE_UNREGISTER = 1 << 8;
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 12;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 16;
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = 1 << 20;
    uint256 internal constant ROLE_ADMIN = 1 << 255;
}

library ResolverRoles {
    uint256 internal constant ROLE_SET_ADDR = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_SET_DATA = 1 << 8;
    uint256 internal constant ROLE_LINK = 1 << 12;
    uint256 internal constant ROLE_UPGRADE = 1 << 16;
    uint256 internal constant ROLE_ADMIN = 1 << 255;
    uint256 internal constant ALL =
        ROLE_SET_ADDR | ROLE_SET_TEXT | ROLE_SET_DATA | ROLE_LINK | ROLE_UPGRADE | ROLE_ADMIN;
}
