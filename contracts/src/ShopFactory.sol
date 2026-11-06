// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPermissionedRegistry} from "./interfaces/IPermissionedRegistry.sol";

/// @title ShopFactory
/// @notice Enrolment book for shops under a platform name. Opening a shop is done by the platform
///         deployer (see OnShiftDeployer._openShopUnder); this contract records who is enrolled so
///         Public Check and the SDK can replace a frontend look-alike constant with on-chain names.
contract ShopFactory {
    address public immutable PLATFORM_ORG;
    IPermissionedRegistry public immutable PLATFORM;

    string[] internal _shops;
    mapping(string label => bool) public enrolled;
    mapping(string label => address shopOrg) public shopOrgOf;

    event ShopEnrolled(string label, address indexed shopOrg, address issuer, address gate);

    error NotPlatformOrg();
    error AlreadyEnrolled();
    error EmptyLabel();

    modifier onlyPlatform() {
        if (msg.sender != PLATFORM_ORG) revert NotPlatformOrg();
        _;
    }

    constructor(IPermissionedRegistry platform, address platformOrg) {
        PLATFORM = platform;
        PLATFORM_ORG = platformOrg;
    }

    function enroll(string calldata label, address shopOrg, address issuer, address gate) external onlyPlatform {
        if (bytes(label).length == 0) revert EmptyLabel();
        if (enrolled[label]) revert AlreadyEnrolled();
        enrolled[label] = true;
        shopOrgOf[label] = shopOrg;
        _shops.push(label);
        emit ShopEnrolled(label, shopOrg, issuer, gate);
    }

    function shopCount() external view returns (uint256) {
        return _shops.length;
    }

    function shopAt(uint256 index) external view returns (string memory) {
        return _shops[index];
    }

    function isEnrolled(string calldata label) external view returns (bool) {
        return enrolled[label];
    }
}
