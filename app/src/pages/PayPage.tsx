import { useEffect, useState, useSyncExternalStore } from "react";
import { BadgeCheck, CreditCard, FlaskConical, Receipt, Smartphone, Wallet } from "lucide-react";
import { Button, CopyButton, Empty, Field, Group, NetworkNote, Qr, Row } from "../components/ui";
import { PlayJourney } from "../components/PlayJourney";
import { useOnShift, type Order } from "../lib/onshift";
import { getPlayLoop, setPlayOrder, subscribePlayLoop } from "../lib/playLoop";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { publicClient } from "../lib/clients";
import { deployment, explorerTx, isLocal } from "../lib/config";
import { clock, sameAddress, short, toUsdcUnits, usdc } from "../lib/format";
import { resolveTill, type TillView } from "../lib/till";
import { mockUSDCAbi, shiftGateAbi } from "../generated/abis";
import { navigate } from "../App";

const unit = isLocal ? "USDC" : "test USDC";

/** The customer side: pay the shop, get an order code, and see refunds land in the same wallet. */
export function PayPage({ demo = false }: { demo?: boolean }) {
  const { snapshot } = useOnShift();
  const { operator, connectWallet, run, busy } = useSession();
  const d = deployment!;
  const me = operator?.signer.address;
  const loop = useSyncExternalStore(subscribePlayLoop, getPlayLoop, () => undefined);
  const [amount, setAmount] = useState("10");
  const [balance, setBalance] = useState<bigint>();
  const [latest, setLatest] = useState<`0x${string}` | undefined>(loop?.orderId as `0x${string}` | undefined);
  const [payHash, setPayHash] = useState<string>();
  const [till, setTill] = useState<TillView>();

  const gateAddress = demo && d.sandboxGate ? d.sandboxGate : undefined;
  const mine: Order[] = (snapshot?.orders ?? []).filter((o) => sameAddress(o.payer, me) && (gateAddress ? sameAddress(o.gate, gateAddress) : !d.sandboxGate || !sameAddress(o.gate, d.sandboxGate)));
  const paidOrder = latest ? mine.find((o) => o.orderId === latest) : undefined;

  useEffect(() => {
    if (loop?.orderId && !latest) setLatest(loop.orderId as `0x${string}`);
  }, [loop?.orderId, latest]);

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

  useEffect(() => {
    if (demo) return;
    let stop = false;
    resolveTill()
      .then((view) => !stop && setTill(view))
      .catch(() => !stop && setTill(undefined));
    return () => {
      stop = true;
    };
  }, [demo, d.orgName, d.parentResolver, snapshot?.tillQuarantined]);

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
        const view = demo ? undefined : till ?? (await resolveTill());
        if (view?.quarantined) throw new Error("Till is quarantined");
        const gate = demo && d.sandboxGate ? d.sandboxGate : view!.gate;
        const allowance = await publicClient.readContract({ address: d.usdc, abi: mockUSDCAbi, functionName: "allowance", args: [me, gate] });
        if (allowance < units) await send(operator.signer, { address: d.usdc, abi: mockUSDCAbi, functionName: "approve", args: [gate, units] });
        const receipt = await send(operator.signer, { address: gate, abi: shiftGateAbi, functionName: "pay", args: [units] });
        const paid = receipt.logs.find((l) => sameAddress(l.address, gate) && l.topics.length === 3);
        if (paid?.topics[1]) {
          const id = paid.topics[1] as `0x${string}`;
          setLatest(id);
          setPayHash(receipt.transactionHash);
          if (demo) setPlayOrder(id);
        }
        return receipt;
      },
      `Paid ${usdc(units)}`,
      demo ? "Order code is ready. Open the staff app — the holder refunds this order back to you." : "Show the order code to the cashier for a refund.",
    );
  };

  const done = Boolean(latest);

  return (
    <div className="device-shell">
      <NetworkNote compact />
      <div className="device">
        <div className="device-bar">
          <span className="btn" style={{ pointerEvents: "none", gap: 8 }}>
            {demo ? <FlaskConical size={15} /> : <CreditCard size={15} />}
            {demo ? "Sandbox pay" : "Customer"}
          </span>
          <span className="small secondary">Step 2 of the demo</span>
        </div>

        <div className="stack" style={{ gap: 18 }}>
          <div style={{ textAlign: "center", padding: "12px 0 0" }}>
            <h1 className="large-title">{demo ? "Pay the sandbox" : `Pay ${d.orgName}`}</h1>
            <p className="page-sub">
              {demo
                ? "This till is only for Playground passes under demo.onshift.eth. The QR below is the order id the staff app refunds — not a pass."
                : "Your payment is an order on chain. A refund can only ever come back to this wallet, and never more than you paid."}
            </p>
          </div>

          {demo && <PlayJourney />}

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
              {demo && loop?.name && (
                <Group pad>
                  <div className="small secondary">Refunding against</div>
                  <div className="play-name" style={{ marginTop: 4 }}>{loop.name}</div>
                </Group>
              )}

              <Group title="Wallet" footer={!isLocal ? "Test USDC on Sepolia has open minting, so anyone can try the full flow." : undefined}>
                <Row icon={Wallet} tint="blue" title={short(me)} subtitle={balance === undefined ? "Reading balance…" : `${usdc(balance)} ${unit}`} trailing={<Button onClick={mint} disabled={busy !== null}>Get 20 {unit}</Button>} plain />
              </Group>

              {!done && (
                <Group pad>
                  <Field label="Amount">
                    <div className="affix">
                      <input className="input input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
                      <span className="suffix">{unit}</span>
                    </div>
                  </Field>
                  {!demo && till?.quarantined && <p className="small secondary" style={{ marginBottom: 8 }}>till.{d.orgName} is quarantined. New payments are refused. A refund of an order you already paid still comes back here.</p>}
                  <Button block variant="primary" disabled={busy !== null || units <= 0n || (!demo && till?.quarantined) || (balance !== undefined && balance < units)} onClick={pay}>
                    {busy === "pay" ? "Paying…" : `Pay ${usdc(units)}`}
                  </Button>
                  {balance !== undefined && balance < units && <p className="small secondary" style={{ marginTop: 8 }}>Not enough {unit}. Get some above first.</p>}
                </Group>
              )}

              {done && latest && (
                <Group pad>
                  <div className="stack-sm" style={{ textAlign: "center" }}>
                    <div className="play-label" style={{ textAlign: "center" }}>Order code · show this to the holder</div>
                    <div style={{ display: "flex", justifyContent: "center" }}>
                      <Qr value={latest} label="Order code" />
                    </div>
                    <div style={{ fontWeight: 700 }}>Order paid{paidOrder ? `: ${usdc(paidOrder.paid)}` : ""}</div>
                    <p className="small secondary" style={{ margin: 0 }}>
                      The QR encodes the order id. The staff app scans or pastes it, then refunds. Money returns only to {short(me)} — the holder never picks a recipient.
                    </p>
                    <div className="mono small secondary" style={{ wordBreak: "break-all" }}>{latest}</div>
                    <div className="row" style={{ justifyContent: "center", flexWrap: "wrap", gap: 8 }}>
                      <CopyButton value={latest} label="Copy Order Code" />
                      {payHash && explorerTx(payHash) && (
                        <a className="play-tx" href={explorerTx(payHash)} target="_blank" rel="noreferrer">
                          View payment tx ↗
                        </a>
                      )}
                    </div>
                    {demo && (
                      <div className="play-actions" style={{ justifyContent: "center", marginTop: 8 }}>
                        <Button variant="primary" icon={Smartphone} onClick={() => navigate("device")}>
                          Next · Refund in staff app
                        </Button>
                        <Button icon={FlaskConical} onClick={() => navigate("try")}>
                          Playground
                        </Button>
                      </div>
                    )}
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
                      onClick={() => {
                        setLatest(o.orderId);
                        if (demo) setPlayOrder(o.orderId);
                      }}
                      plain
                    />
                  ))
                )}
              </Group>

              {demo && loop?.name && (
                <div className="play-actions" style={{ justifyContent: "center" }}>
                  <Button icon={BadgeCheck} onClick={() => navigate("verify", { name: loop.name })}>
                    Public check pass
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
