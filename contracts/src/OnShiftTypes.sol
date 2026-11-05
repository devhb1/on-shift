// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared constants between PassIssuer (writer) and ShiftGate / verifiers (readers).
library OnShiftTypes {
    /// @dev Actions a pass may perform through ShiftGate (bitmask stored in the scope record).
    uint8 internal constant ACTION_REFUND = 1 << 0;
    uint8 internal constant ACTION_CHECK_IN = 1 << 1;

    /// @dev Record keys written into each pass's own resolver.
    string internal constant KEY_SCOPE = "pass.scope"; // data: abi.encode(Scope)
    string internal constant KEY_STATUS = "shift.status"; // text: the ONLY key staff may write
    string internal constant KEY_ORG = "org"; // text
    string internal constant KEY_ROLE = "role"; // text
    string internal constant KEY_AGENT_CONTEXT = "agent-context"; // text, ENSIP-26 agent record
    uint256 internal constant COIN_TYPE_ETH = 60;

    /// @dev Parent (org) resolver keys flipped by IncidentSwitch.
    string internal constant KEY_OPS_STATUS = "ops.status"; // "ok" | "incident"
    string internal constant KEY_OPS_INCIDENT = "ops.incident"; // free-text reason

    /// @notice The scope a pass was issued with. `expiry` binds the scope to one registration, so a
    ///         revived (renewed) name never matches its old scope — see ShiftGate.ScopeMismatch.
    struct Scope {
        uint256 cap; // max spend through ShiftGate during this pass, in USDC base units
        uint64 expiry;
        uint8 actions;
        uint8 presetId;
    }
}
