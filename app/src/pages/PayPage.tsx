import { useEffect, useState } from "react";
import { CreditCard, Receipt, Wallet } from "lucide-react";
import { Button, CopyButton, Empty, Field, Group, NetworkNote, Qr, Row } from "../components/ui";
import { useOnShift, type Order } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { publicClient } from "../lib/clients";
import { deployment, isLocal } from "../lib/config";
import { clock, sameAddress, short, toUsdcUnits, usdc } from "../lib/format";
import { mockUSDCAbi, shiftGateAbi } from "../generated/abis";
import { ThemeToggle, navigate } from "../App";

const unit = isLocal ? "USDC" : "test USDC";

/** The customer side: pay the shop, get an order code, and see refunds land in the same wallet. */
export function PayPage() {
  const { snapshot } = useOnShift();
  const { operator, connectWallet, run, busy } = useSession();
  const d = deployment!;
  const me = operator?.signer.address;
  const [amount, setAmount] = useState("10");
  const [balance, setBalance] = useState<bigint>();
  const [latest, setLatest] = useState<`0x${string}`>();

  const mine: Order[] = (snapshot?.orders ?? []).filter((o) => sameAddress(o.payer, me));
  const shown = latest ? mine.find((o) => o.orderId === latest) : undefined;

  useEffect(() => {
    if (!me) return setBalance(undefined);
    let stop = false;
    const read = () =>
      publicClient
        .readContract({ address: d.usdc, abi: mockUSDCAbi, functionName: "balanceOf", args: [me] })
        .then((b) => !stop && setBalance(b))
        .catch(() => {});
    read();
    const t = setInterval(read, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [me, d.usdc, snapshot]);

  const units = (() => {
    try {
      return toUsdcUnits(amount);
    } catch {
      return 0n;
    }
  })();

  const mint = () =>
    run("mint", () => send(operator!.signer, { address: d.usdc, abi: mockUSDCAbi, functionName: "mint", args: [me!, 20_000_000n] }), `20 ${unit} added`, "Open-mint testnet token, for trying the flow.");

  const pay = async () => {
    if (!operator || !me) return;
    await run(
      "pay",
      async () => {
        const allowance = await publicClient.readContract({ address: d.usdc, abi: mockUSDCAbi, functionName: "allowance", args: [me, d.shiftGate] });
        if (allowance < units) await send(operator.signer, { address: d.usdc, abi: mockUSDCAbi, functionName: "approve", args: [d.shiftGate, units] });
        const receipt = await send(operator.signer, { address: d.shiftGate, abi: shiftGateAbi, functionName: "pay", args: [units] });
        const paid = receipt.logs.find((l) => sameAddress(l.address, d.shiftGate) && l.topics.length === 3);
        if (paid?.topics[1]) setLatest(paid.topics[1]);
        return receipt;
      },
      `Paid ${usdc(units)}`,
      "Show the order code to the cashier for a refund.",
    );
  };

  return (
    <div className="device-shell">
      <NetworkNote compact />
      <div className="device">
        <div className="device-bar">
          <span className="btn" style={{ pointerEvents: "none" }}>
            <CreditCard size={15} /> Customer
          </span>
          <div className="row">
            <ThemeToggle />
            <Button variant="plain" onClick={() => navigate("home")}>
              Home
            </Button>
          </div>
        </div>

        <div className="stack" style={{ gap: 18 }}>
          <div style={{ textAlign: "center", padding: "12px 0 0" }}>
            <h1 className="large-title">Pay {d.orgName}</h1>
            <p className="page-sub">Your payment is an order on chain. A refund can only ever come back to this wallet, and never more than you paid.</p>
          </div>

          {!me ? (
            <Group pad>
              <div className="stack-sm" style={{ textAlign: "center" }}>
                <p className="secondary small">Connect the wallet you are paying from.</p>
                <Button variant="primary" icon={Wallet} onClick={() => connectWallet()}>
                  Connect Wallet
                </Button>
              </div>
            </Group>
          ) : (
            <>
              <Group title="Wallet" footer={!isLocal ? "Test USDC on Sepolia has open minting, so anyone can try the full flow." : undefined}>
                <Row icon={Wallet} tint="blue" title={short(me)} subtitle={balance === undefined ? "Reading balance…" : `${usdc(balance)} ${unit}`} trailing={<Button onClick={mint} disabled={busy !== null}>Get 20 {unit}</Button>} plain />
              </Group>

              <Group pad>
                <Field label="Amount">
                  <div className="affix">
                    <input className="input input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
                    <span className="suffix">{unit}</span>
                  </div>
                </Field>
                <Button block variant="primary" disabled={busy !== null || units <= 0n || (balance !== undefined && balance < units)} onClick={pay}>
                  {busy === "pay" ? "Paying…" : `Pay ${usdc(units)}`}
                </Button>
                {balance !== undefined && balance < units && <p className="small secondary" style={{ marginTop: 8 }}>Not enough {unit}. Get some above first.</p>}
              </Group>

              {shown && (
                <Group pad>
                  <div className="stack-sm" style={{ textAlign: "center" }}>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <Qr value={shown.orderId} label="Order code" />
                    </div>
                    <div style={{ fontWeight: 700 }}>Order paid: {usdc(shown.paid)}</div>
                    <div className="mono small secondary" style={{ wordBreak: "break-all" }}>{shown.orderId}</div>
                    <div className="row" style={{ justifyContent: "center" }}>
                      <CopyButton value={shown.orderId} label="Copy Order Code" />
                    </div>
                  </div>
                </Group>
              )}

              <Group title="Your orders">
                {mine.length === 0 ? (
                  <Empty icon={Receipt} title="No orders yet">Pay above and your order appears here.</Empty>
                ) : (
                  mine.slice(0, 8).map((o) => (
                    <Row
                      key={o.orderId}
                      icon={Receipt}
                      tint={o.refunded > 0n ? "orange" : "green"}
                      title={`${usdc(o.paid)} paid${o.refunded > 0n ? ` · ${usdc(o.refunded)} refunded` : ""}`}
                      subtitle={`${o.orderId.slice(0, 10)}… · ${o.ts ? clock(o.ts) : "just now"}`}
                      trailing={<CopyButton value={o.orderId} label="Code" />}
                    />
                  ))
                )}
              </Group>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
