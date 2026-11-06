import { BaseError, ContractFunctionRevertedError } from "viem";
import { isLocal } from "./config";

export type Explained = { name?: string; title: string; detail?: string };

/** Plain-language meaning of every custom error a user can hit. No hashes, no selectors. */
const MESSAGES: Record<string, { title: string; detail: string }> = {
  PassNotLive: {
    title: "Pass is not live",
    detail: "The pass has expired, was revoked, or the ops namespace is frozen. Checked against the ENS registry state.",
  },
  NotPassHolder: { title: "Not the pass holder", detail: "Only the wallet that holds this pass can act with it." },
  ActionNotAllowed: { title: "Action outside scope", detail: "This pass's role does not include that action." },
  ScopeMismatch: {
    title: "Revived pass refused",
    detail: "The registration was renewed after expiry. Its scope was bound to the old expiry, so the gate refuses it.",
  },
  OverCap: { title: "Over the shift cap", detail: "This refund would exceed the spending cap written into the pass." },
  Replay: { title: "Already processed", detail: "That ticket was already checked in." },
  UnknownOrder: { title: "No such order", detail: "The gate has no payment with that order code. Refunds only go to orders a customer actually paid." },
  OverRefund: { title: "More than was paid", detail: "This refund would return more than is left on the order." },
  InvalidAmount: { title: "Enter an amount", detail: "The amount must be more than zero." },
  CapTooHigh: { title: "Playground cap is $5", detail: "Playground passes can refund at most 5 test USDC." },
  DurationTooLong: { title: "Playground passes last an hour", detail: "Pick a duration of one hour or less." },
  TooManyToday: { title: "Playground limit reached", detail: "Each wallet can issue three Playground passes a day." },
  NotRequester: { title: "Not your pass", detail: "Only the wallet that issued this Playground pass can end it." },
  NotOrg: { title: "Organisation wallet only", detail: "Connect the wallet that administers this organisation." },
  NotLead: { title: "Not a shift lead", detail: "Only an active shift lead can issue passes." },
  NotAuthorizedToRevoke: { title: "Cannot revoke", detail: "Only the lead who issued the pass, or the org, can revoke it." },
  DailyBudgetExhausted: { title: "Daily budget used up", detail: "This lead has issued all passes allowed today." },
  InvalidDuration: { title: "Invalid duration", detail: "Duration must be between 30 seconds and the role's maximum." },
  InvalidPreset: { title: "Unknown role", detail: "Pick one of the available roles." },
  CapAboveLimit: { title: "Cap too high", detail: "The cap is above the maximum allowed for this role." },
  InvalidLabel: { title: "Invalid name", detail: "Use 1-32 lowercase letters, digits or hyphens." },
  InvalidHolder: { title: "Missing holder", detail: "Choose who receives the pass." },
  GasDripTooHigh: { title: "Gas allowance too high", detail: "At most 0.05 ETH can be sent with a pass." },
  NamespaceFrozen: { title: "Namespace frozen", detail: "Break-glass is active. Restore the namespace before issuing." },
  UnknownPass: { title: "Unknown pass", detail: "No pass with that name was issued here." },
  LabelAlreadyRegistered: { title: "Name in use", detail: "That pass name is live right now. Pick another name." },
  LabelExpired: { title: "Already ended", detail: "This pass is no longer registered." },
  TransferDisallowed: {
    title: "Transfer blocked by ENSv2",
    detail: "The pass was registered with roleBitmap 0: no ROLE_CAN_TRANSFER_ADMIN, so it can never change hands.",
  },
  ERC1155MissingApprovalForAll: { title: "Not the owner", detail: "This wallet does not own that pass." },
  EACCannotGrantRoles: { title: "Not allowed", detail: "This wallet cannot grant that permission." },
  EACUnauthorizedAccountRoles: {
    title: "Blocked by ENSv2 permissions",
    detail: "This wallet holds no role for that record. Staff can only write their own shift.status.",
  },
  AlreadyInIncident: { title: "Already in incident mode", detail: "Break-glass is already active." },
  NotInIncident: { title: "Nothing to restore", detail: "The namespace is not in incident mode." },
  InsufficientBalance: { title: "Gate float empty", detail: "The payment gate does not hold enough test USDC for this refund." },
};

export function explain(error: unknown): Explained {
  if (error instanceof BaseError) {
    const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName;
      if (name && MESSAGES[name]) return { name, ...MESSAGES[name] };
      if (name) return { name, title: name };
      return { title: "Transaction reverted", detail: revert.reason ?? revert.shortMessage };
    }
    if (/user rejected|denied transaction|rejected the request/i.test(error.message)) {
      return { title: "Cancelled", detail: "You declined the request in your wallet." };
    }
    if (/insufficient funds/i.test(error.message)) {
      return {
        title: "Not enough ETH",
        detail: isLocal
          ? "This wallet has no ETH for gas."
          : "This wallet needs Sepolia ETH for gas. Passes can include a small gas allowance for the holder.",
      };
    }
    if (/fetch|ECONNREFUSED|HTTP request failed|Failed to fetch/i.test(error.message)) {
      return {
        title: "Chain unreachable",
        detail: isLocal ? "Start the local chain with npm run dev, then reload." : "The network didn't respond. Wait a moment and try again.",
      };
    }
    return { title: error.shortMessage };
  }
  return { title: error instanceof Error ? error.message : String(error) };
}
