// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Role bits, identical to ensdomains/contracts-v2 RegistryRolesLib and PermissionedResolverLib.
///         Each role has an admin counterpart in the high 128 bits (`role << 128`): holding the admin bit
///         lets an account grant or revoke that role.
library RegistryRoles {
    uint256 internal constant ROLE_REGISTRAR = 1 << 0;
    uint256 internal constant ROLE_REGISTER_RESERVED = 1 << 4;
    uint256 internal constant ROLE_SET_PARENT = 1 << 8;
    uint256 internal constant ROLE_UNREGISTER = 1 << 12;
    uint256 internal constant ROLE_RENEW = 1 << 16;
    uint256 internal constant ROLE_SET_SUBREGISTRY = 1 << 20;
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;
    uint256 internal constant ROLE_CAN_TRANSFER_ADMIN = (1 << 28) << 128;
    uint256 internal constant ROLE_UPGRADE = 1 << 124;

    function admin(uint256 roles) internal pure returns (uint256) {
        return roles << 128;
    }

    /// @dev `roles` plus the admin bit of each.
    function withAdmin(uint256 roles) internal pure returns (uint256) {
        return roles | (roles << 128);
    }
}

library ResolverRoles {
    uint256 internal constant ROLE_SET_ADDR = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_SET_DATA = 1 << 36;
    uint256 internal constant ROLE_UPGRADE = 1 << 124;

    uint256 internal constant RECORDS = ROLE_SET_ADDR | ROLE_SET_TEXT | ROLE_SET_DATA;

    function withAdmin(uint256 roles) internal pure returns (uint256) {
        return roles | (roles << 128);
    }
}
