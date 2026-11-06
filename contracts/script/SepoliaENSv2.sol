// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice ENSv2 on Sepolia, from ensdomains/contracts-v2 contracts/deployments/sepolia (2026-10-01 redeploy).
library SepoliaENSv2 {
    address internal constant VERIFIABLE_FACTORY = 0x118Bc31A50d559F7015a8Da26d54B3b030CdB70F;
    address internal constant USER_REGISTRY_IMPL = 0x840Fa461059862Ea466A711E8C98c8dE732061C0;
    address internal constant PERMISSIONED_RESOLVER_IMPL = 0x7E4B2d59938930168024201752EE5503df402303;
    address internal constant ETH_REGISTRY = 0x67b728a792e789a8978b30cF1b3b641f19354b43;
    address internal constant ETH_REGISTRAR = 0xa4449a0dD2b83007553D9b1d28b583A46A805a30;
    address internal constant UNIVERSAL_RESOLVER_V2 = 0x85eDf8B6b7D4211e2b07AA687506B746357B92cf;
    address internal constant MOCK_USDC = 0xD3322B29a7BdEe707D1684676f149bf41Aa3422f;
}
