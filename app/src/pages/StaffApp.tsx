import { useState } from "react";
import { keccak256, toHex, type Hex } from "viem";
import { BadgeCheck, Bot, CircleDollarSign, Lock, MessageSquare, PlusCircle, ShieldCheck, ShieldX, Smartphone, Ticket, Trash2 } from "lucide-react";
import { Button, Card, CopyButton, Countdown, Empty, Field, Progress, Qr, StatePill } from "../components/ui";
import { labelId, useOnShift, type PassRow } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send, simulate } from "../lib/tx";
import { explain } from "../lib/errors";
import { ACTION_CHECK_IN, ACTION_REFUND, deployment } from "../lib/config";
import { ATTACKER_ADDRESS, CUSTOMER_ADDRESS } from "../lib/identities";
import { sameAddress, toUsdcUnits, usdc } from "../lib/format";
import { permissionedRegistryAbi, permissionedResolverAbi, shiftGateAbi } from "../generated/abis";
import { publicClient } from "../lib/clients";
import { navigate } from "../App";

const randomId = (): Hex => keccak256(toHex(`${Date.now()}-${Math.random()}`));

type Probe = { label: string; outcome: "blocked" | "allowed"; title: string; detail?: string };

export function StaffApp() {
  const { snapshot } = useOnShift();
  const { active, staffDevices, setActive, addDevice, deleteDevice } = useSession();
  const s = snapshot!;

  if (active.kind !== "staff" && active.kind !== "agent") {
    return (
      <Card title="Pick a device" icon={Smartphone}>
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            The staff app runs on the holder's own phone with a key that never leaves it. Choose a device to act as, or
            create one.
          </p>
          <div className="segmented">
            {staffDevices.map((x) => (
              <button key={x.id} className="choice" onClick={() => setActive(x.id)}>
                <div className="choice-title"><Smartphone size={15} /> {x.label}</div>
                <div className="choice-sub">{s.passes.some((p) => p.state === "live" && sameAddress(p.holder, x.address)) ? "On shift" : "No live pass"}</div>
              </button>
            ))}
            <button className="choice" onClick={() => setActive("agent")}>
              <div className="choice-title"><Bot size={15} /> AI agent wallet</div>
              <div className="choice-sub">Agents use passes the same way</div>
            </button>
            <button className="choice" onClick={() => setActive(addDevice(`Staff phone ${staffDevices.length + 1}`).id)}>
              <div className="choice-title"><PlusCircle size={15} /> New staff device</div>
              <div className="choice-sub">Generates a burner key here</div>
            </button>
          </div>
        </div>
      </Card>
    );
  }

  const mine = s.passes.filter((p) => sameAddress(p.holder, active.address));
  const pass = mine.find((p) => p.state === "live") ?? mine[0];

  return (
    <>
      {!pass ? (
        <div className="grid grid-2">
          <Card title="Show this to your shift lead" icon={Smartphone}>
            <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
              <Qr value={active.address} label="Device address" />
              <div className="small muted">Your shift lead scans this to issue your pass. No account, no password, no seed phrase.</div>
              <div className="row">
                <CopyButton value={active.address} label="Copy device ID" />
                {active.kind === "staff" && (
                  <button className="btn btn-sm btn-danger" onClick={() => deleteDevice(active.id)}>
                    <Trash2 size={14} /> Remove device
                  </button>
                )}
              </div>
            </div>
          </Card>
          <Card title="Waiting for a pass" icon={BadgeCheck}>
            <Empty icon={BadgeCheck} title={`${active.label} has no pass yet`}>
              Once issued, your badge, countdown and allowed actions appear here.
            </Empty>
            <Button block icon={PlusCircle} onClick={() => navigate("issue")}>Go to Issue pass</Button>
          </Card>
        </div>
      ) : (
        <PassView pass={pass} />
      )}
    </>
  );
}

function PassView({ pass }: { pass: PassRow }) {
  const { snapshot } = useOnShift();
  const { active, run, busy } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const preset = s.presets[pass.presetId];
  const live = pass.state === "live";
  const canRefund = (preset?.actions & ACTION_REFUND) !== 0;
  const canCheckIn = (preset?.actions & ACTION_CHECK_IN) !== 0;

  const [status, setStatus] = useState("");
  const [amount, setAmount] = useState("10");
  const [ticket, setTicket] = useState("TKT-1042");
  const [probes, setProbes] = useState<Probe[]>([]);

  const node = (): Promise<Hex> =>
    publicClient.readContract({ address: d.passIssuer, abi: [{ type: "function", name: "nodeOf", stateMutability: "view", inputs: [{ name: "label", type: "string" }], outputs: [{ type: "bytes32" }] }] as const, functionName: "nodeOf", args: [pass.label] });

  const updateStatus = () =>
    run(
      "status",
      async () =>
        send(active.privateKey, {
          address: pass.resolver,
          abi: permissionedResolverAbi,
          functionName: "setText",
          args: [await node(), "shift.status", status],
        }),
      "Status updated",
      "Written to your pass's ENS record. Anyone verifying you sees it.",
    ).then((ok) => ok && setStatus(""));

  const refund = () =>
    run(
      "refund",
      () =>
        send(active.privateKey, {
          address: d.shiftGate,
          abi: shiftGateAbi,
          functionName: "refund",
          args: [pass.label, CUSTOMER_ADDRESS, toUsdcUnits(amount), randomId()],
        }),
      `Refunded ${usdc(toUsdcUnits(amount))}`,
      "Paid from the gate float to the customer.",
    );

  const checkIn = () =>
    run(
      "checkin",
      () =>
        send(active.privateKey, {
          address: d.shiftGate,
          abi: shiftGateAbi,
          functionName: "checkIn",
          args: [pass.label, keccak256(toHex(ticket))],
        }),
      "Ticket checked in",
      ticket,
    );

  /** Forbidden actions are simulated (no gas): the point is to show the chain refusing them. */
  const probe = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
      setProbes((p) => [{ label, outcome: "allowed" as const, title: "This would have succeeded" }, ...p].slice(0, 5));
    } catch (e) {
      const x = explain(e);
      setProbes((p) => [{ label, outcome: "blocked" as const, title: x.title, detail: x.detail }, ...p].slice(0, 5));
    }
  };

  const remaining = pass.cap - pass.spent;

  return (
    <div className="grid grid-main">
      <div className="stack" style={{ gap: 22 }}>
        <Card className="badge">
          <div className="badge-ring">
            <div className="badge-ring-inner">
              <div>
                {live ? <Countdown expiry={pass.expiry} className="badge-time" /> : <div className="badge-time">00:00</div>}
                <div className="small muted">{live ? "left on shift" : "shift ended"}</div>
              </div>
            </div>
          </div>
          <div className="badge-name">{pass.name}</div>
          <div className="row" style={{ justifyContent: "center", marginTop: 10 }}>
            <StatePill state={pass.state} />
            <span className="pill blue">{preset?.name}</span>
          </div>
          {live && pass.cap > 0n && (
            <div style={{ maxWidth: 360, margin: "20px auto 0" }}>
              <div className="row between small muted" style={{ marginBottom: 6 }}>
                <span>Used {usdc(pass.spent)}</span>
                <span>{usdc(remaining)} left</span>
              </div>
              <Progress value={pass.spent} max={pass.cap} />
            </div>
          )}
          <div className="row row-wrap" style={{ justifyContent: "center", marginTop: 20 }}>
            <span className="chip allowed">Update status</span>
            {canRefund && <span className="chip allowed">Refund ≤ {usdc(pass.cap)}</span>}
            {canCheckIn && <span className="chip allowed">Check in</span>}
            <span className="chip locked"><Lock size={13} /> Payout address</span>
            <span className="chip locked"><Lock size={13} /> Transfer</span>
          </div>
        </Card>

        <Card title="Try to misuse this pass" icon={ShieldCheck}>
          <p className="small muted" style={{ marginTop: 0 }}>
            A rogue holder - or a stolen phone - tries the dangerous things. Each attempt is checked against the chain without
            spending gas.
          </p>
          <div className="row row-wrap">
            <button
              className="btn btn-sm"
              onClick={() =>
                probe("Change payout address", async () =>
                  simulate(active.privateKey, {
                    address: pass.resolver,
                    abi: permissionedResolverAbi,
                    functionName: "setAddr",
                    args: [await node(), 60n, ATTACKER_ADDRESS],
                  }),
                )
              }
            >
              Redirect payouts to me
            </button>
            <button
              className="btn btn-sm"
              onClick={() =>
                probe("Transfer the pass", async () => {
                  const st = await publicClient.readContract({ address: pass.registry, abi: permissionedRegistryAbi, functionName: "getState", args: [labelId(pass.label)] });
                  await simulate(active.privateKey, {
                    address: pass.registry,
                    abi: permissionedRegistryAbi,
                    functionName: "safeTransferFrom",
                    args: [active.address, ATTACKER_ADDRESS, st.tokenId, 1n, "0x"],
                  });
                })
              }
            >
              Sell the pass
            </button>
            {canRefund && (
              <button
                className="btn btn-sm"
                onClick={() =>
                  probe("Refund over the cap", () =>
                    simulate(active.privateKey, {
                      address: d.shiftGate,
                      abi: shiftGateAbi,
                      functionName: "refund",
                      args: [pass.label, ATTACKER_ADDRESS, remaining + 1_000_000n, randomId()],
                    }),
                  )
                }
              >
                Refund {usdc(remaining + 1_000_000n)} to a friend
              </button>
            )}
            <button
              className="btn btn-sm"
              onClick={() =>
                probe("Raise my own cap", async () =>
                  simulate(active.privateKey, {
                    address: pass.resolver,
                    abi: permissionedResolverAbi,
                    functionName: "setData",
                    args: [await node(), "pass.scope", "0x01"],
                  }),
                )
              }
            >
              Raise my cap
            </button>
          </div>
          {probes.length > 0 && (
            <div className="stack" style={{ marginTop: 16, gap: 10 }}>
              {probes.map((p, i) => (
                <div key={i} className="well row" style={{ alignItems: "flex-start" }}>
                  {p.outcome === "blocked" ? <ShieldCheck size={20} color="var(--green)" /> : <ShieldX size={20} color="var(--red)" />}
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {p.label}: {p.outcome === "blocked" ? "blocked" : "allowed"}
                    </div>
                    <div className="small muted">
                      {p.title}
                      {p.detail ? ` - ${p.detail}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="stack" style={{ gap: 22 }}>
        {!live && (
          <div className="banner amber">
            <Lock size={18} />
            <div>
              This pass has {pass.state === "revoked" ? "been revoked" : pass.state === "killed" ? "been stopped by break-glass" : "expired"}.
              Nobody had to send a transaction for an expiry. The buttons below still try - and the gate refuses.
            </div>
          </div>
        )}
        <Card title="Shift status" icon={MessageSquare}>
          <div className="stack">
            <div className="well small">
              <span className="muted">Now showing: </span>
              <b>{pass.shiftStatus || "-"}</b>
            </div>
            <Field label="New status" hint="The only record you are allowed to write.">
              <input className="input" placeholder="e.g. Lane 3, back in 5" value={status} onChange={(e) => setStatus(e.target.value)} />
            </Field>
            <Button icon={MessageSquare} loading={busy === "status"} disabled={!status} onClick={updateStatus}>
              Update status
            </Button>
          </div>
        </Card>

        {canRefund && (
          <Card title="Refund a customer" icon={CircleDollarSign}>
            <div className="stack">
              <Field label="Amount" hint="Goes to the demo customer wallet. Order IDs are generated, so each refund is unique.">
                <div className="input-affix">
                  <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <span>USDC</span>
                </div>
              </Field>
              <Button variant="primary" icon={CircleDollarSign} loading={busy === "refund"} disabled={!Number(amount)} onClick={refund}>
                Refund
              </Button>
            </div>
          </Card>
        )}

        {canCheckIn && (
          <Card title="Check in a ticket" icon={Ticket}>
            <div className="stack">
              <Field label="Ticket code">
                <input className="input" value={ticket} onChange={(e) => setTicket(e.target.value)} />
              </Field>
              <Button icon={Ticket} loading={busy === "checkin"} disabled={!ticket} onClick={checkIn}>
                Check in
              </Button>
            </div>
          </Card>
        )}

        <Button icon={BadgeCheck} onClick={() => navigate("verify", { name: pass.name })}>
          See what customers see
        </Button>
      </div>
    </div>
  );
}
