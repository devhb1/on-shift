import { useEffect, useState, useSyncExternalStore } from "react";
import { isHex, keccak256, toHex, type Hex } from "viem";
import {
  BadgeCheck,
  Bot,
  Check,
  CircleDollarSign,
  Clock3,
  FlaskConical,
  Lock,
  MessageSquare,
  Plus,
  ShieldCheck,
  ShieldX,
  Smartphone,
  Ticket,
  Trash2,
} from "lucide-react";
import { Button, CopyButton, Empty, Field, Group, Meter, NetworkNote, Qr, Row, Sheet } from "../components/ui";
import { PlayJourney } from "../components/PlayJourney";
import { PassCard } from "../components/PassCard";
import { labelId, passNode, useOnShift, type PassRow } from "../lib/onshift";
import { getPlayLoop, setPlayRefunded, subscribePlayLoop } from "../lib/playLoop";
import { passPreset } from "./shared";
import { useSession } from "../lib/session";
import { send, simulate } from "../lib/tx";
import { explain } from "../lib/errors";
import { publicClient } from "../lib/clients";
import { ACTION_CHECK_IN, ACTION_REFUND, deployment, isLocal } from "../lib/config";
import { ATTACKER_ADDRESS, type Device } from "../lib/identities";
import { clock, sameAddress, short, toUsdcUnits, usdc } from "../lib/format";
import { permissionedRegistryAbi, permissionedResolverAbi, shiftGateAbi } from "../generated/abis";
import { ThemeToggle, navigate } from "../App";

const randomId = (): Hex => keccak256(toHex(`${Date.now()}-${Math.random()}`));

export function DeviceApp() {
  const { devices, device, setDevice, addDevice } = useSession();
  const [picking, setPicking] = useState(false);

  return (
    <div className="device-shell">
      <NetworkNote compact />
      <div className="device">
        <div className="device-bar">
          <button className="btn" onClick={() => setPicking(true)}>
            {device?.kind === "agent" ? <Bot size={15} /> : <Smartphone size={15} />}
            {device ? device.name : "Choose device"}
          </button>
          <div className="row">
            <ThemeToggle />
            <Button variant="plain" onClick={() => navigate("try")}>
              Playground
            </Button>
            <Button variant="plain" onClick={() => navigate("overview")}>
              Console
            </Button>
          </div>
        </div>

        {device ? <DeviceHome device={device} /> : <Pick devices={devices} onPick={setDevice} onCreate={(k) => addDevice(k === "agent" ? `Agent ${devices.filter((d) => d.kind === "agent").length + 1}` : `Staff phone ${devices.filter((d) => d.kind === "staff").length + 1}`, k)} />}

        {picking && (
          <Sheet onClose={() => setPicking(false)}>
            <div className="sheet-title" style={{ marginBottom: 14 }}>
              This device is…
            </div>
            <Pick
              devices={devices}
              selected={device?.id}
              onPick={(id) => {
                setDevice(id);
                setPicking(false);
              }}
              onCreate={(k) => {
                addDevice(k === "agent" ? `Agent ${devices.filter((d) => d.kind === "agent").length + 1}` : `Staff phone ${devices.filter((d) => d.kind === "staff").length + 1}`, k);
                setPicking(false);
              }}
            />
          </Sheet>
        )}
      </div>
    </div>
  );
}

function Pick({ devices, selected, onPick, onCreate }: { devices: Device[]; selected?: string; onPick: (id: string) => void; onCreate: (kind: "staff" | "agent") => void }) {
  const { snapshot } = useOnShift();
  return (
    <div className="stack" style={{ gap: 18 }}>
      {!selected && (
        <div style={{ textAlign: "center", padding: "24px 0 4px" }}>
          <h1 className="large-title">Staff App</h1>
          <p className="page-sub">Your pass, your limits, and nothing else. Keys stay on this device.</p>
        </div>
      )}
      {devices.length > 0 && (
        <Group title="Devices">
          {devices.map((d) => (
            <Row
              key={d.id}
              icon={d.kind === "agent" ? Bot : Smartphone}
              tint={d.kind === "agent" ? "graphite" : "blue"}
              title={d.name}
              subtitle={snapshot?.passes.some((p) => p.state === "live" && sameAddress(p.holder, d.signer.address)) ? "On shift" : short(d.signer.address)}
              trailing={selected === d.id ? <Check size={16} color="var(--blue)" /> : undefined}
              chevron={selected !== d.id}
              onClick={() => onPick(d.id)}
            />
          ))}
        </Group>
      )}
      <Group>
        <Row icon={Plus} tint="green" title="Set up as a staff phone" onClick={() => onCreate("staff")} />
        <Row icon={Plus} tint="graphite" title="Set up as an AI agent" onClick={() => onCreate("agent")} />
      </Group>
    </div>
  );
}

function DeviceHome({ device }: { device: Device }) {
  const { snapshot } = useOnShift();
  const s = snapshot!;
  const mine = s.passes.filter((p) => sameAddress(p.holder, device.signer.address));
  const pass = mine.find((p) => p.state === "live") ?? mine[0];
  if (!pass) return <Onboarding device={device} />;
  return <PassHome key={pass.index} device={device} pass={pass} history={mine.filter((p) => p.index !== pass.index)} />;
}

function Onboarding({ device }: { device: Device }) {
  const { deleteDevice } = useSession();
  return (
    <div className="stack" style={{ gap: 18 }}>
      <Group pad>
        <div style={{ textAlign: "center" }} className="stack-sm">
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Qr value={device.signer.address} label="Device code" />
          </div>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>Show this to your shift lead</div>
          <p className="secondary small">
            They paste this code to give this {device.kind === "agent" ? "agent" : "phone"} a pass. The key stays in this browser. Clearing site data deletes it, and the pass cannot be moved.
          </p>
          <div className="mono small secondary">{device.signer.address}</div>
          <div className="row" style={{ justifyContent: "center" }}>
            <CopyButton value={device.signer.address} label="Copy Code" />
          </div>
        </div>
      </Group>
      <Group>
        <Empty icon={Clock3} title="Waiting for a pass">
          Your badge appears here the moment it's issued.
        </Empty>
      </Group>
      {device.id !== "agent" && (
        <Button variant="plain danger" icon={Trash2} onClick={() => deleteDevice(device.id)}>
          Remove This Device
        </Button>
      )}
    </div>
  );
}

type Probe = { label: string; blocked: boolean; why: string };

function PassHome({ device, pass, history }: { device: Device; pass: PassRow; history: PassRow[] }) {
  const { snapshot } = useOnShift();
  const { run, busy } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const preset = passPreset(s, pass);
  const gate = pass.sandbox && d.sandboxGate ? d.sandboxGate : d.shiftGate;
  const live = pass.state === "live";
  const canRefund = (preset?.actions & ACTION_REFUND) !== 0;
  const canCheckIn = (preset?.actions & ACTION_CHECK_IN) !== 0;
  const remaining = pass.cap - pass.spent;

  const loop = useSyncExternalStore(subscribePlayLoop, getPlayLoop, () => undefined);
  const [sheet, setSheet] = useState<"refund" | "checkin" | "status" | null>(null);
  const [amount, setAmount] = useState("10");
  const [orderCode, setOrderCode] = useState("");
  const [ticket, setTicket] = useState("TKT-1042");
  const [status, setStatus] = useState("");
  const [probes, setProbes] = useState<Record<string, Probe>>({});

  useEffect(() => {
    if (pass.sandbox && loop?.orderId && !orderCode) setOrderCode(loop.orderId);
  }, [pass.sandbox, loop?.orderId, orderCode]);

  const node = () => passNode(pass.label, pass.sandbox ? "demo" : "ops");
  const openOrders = s.orders.filter((o) => sameAddress(o.gate, gate) && o.paid > o.refunded);
  const codeOk = isHex(orderCode) && orderCode.length === 66;
  const order = codeOk ? s.orders.find((o) => sameAddress(o.gate, gate) && o.orderId.toLowerCase() === orderCode.toLowerCase()) : undefined;
  const amountUnits = (() => {
    try {
      return toUsdcUnits(amount);
    } catch {
      return 0n;
    }
  })();
  const bigOrder = s.orders.find((o) => sameAddress(o.gate, gate) && o.paid - o.refunded > remaining);

  const act = async (key: "refund" | "checkin" | "status") => {
    setSheet(null);
    if (key === "refund") {
      const ok = await run(
        "refund",
        () => send(device.signer, { address: gate, abi: shiftGateAbi, functionName: "refund", args: [pass.label, orderCode as Hex, amountUnits] }),
        `Refunded ${usdc(amountUnits)}`,
        "Sent back to the wallet that paid the order.",
      );
      if (ok && pass.sandbox) setPlayRefunded();
    }
    if (key === "checkin")
      await run(
        "checkin",
        () => send(device.signer, { address: gate, abi: shiftGateAbi, functionName: "checkIn", args: [pass.label, keccak256(toHex(ticket))] }),
        "Checked in",
        ticket,
      );
    if (key === "status")
      await run(
        "status",
        async () => send(device.signer, { address: pass.resolver, abi: permissionedResolverAbi, functionName: "setText", args: [await node(), "shift.status", status] }),
        "Status updated",
        "Anyone checking your pass now sees it.",
      ).then((ok) => ok && setStatus(""));
  };

  const probe = async (key: string, label: string, fn: () => Promise<void>) => {
    try {
      await fn();
      setProbes((p) => ({ ...p, [key]: { label, blocked: false, why: "This would have succeeded." } }));
    } catch (e) {
      const x = explain(e);
      setProbes((p) => ({ ...p, [key]: { label, blocked: true, why: x.detail ? `${x.title}. ${x.detail}` : x.title } }));
    }
  };

  const PROBES: { key: string; label: string; run: () => Promise<void> }[] = [
    {
      key: "payout",
      label: "Send payouts to my own wallet",
      run: async () => simulate(device.signer, { address: pass.resolver, abi: permissionedResolverAbi, functionName: "setAddr", args: [await node(), 60n, ATTACKER_ADDRESS] }),
    },
    {
      key: "transfer",
      label: "Give this pass to a friend",
      run: async () => {
        const st = await publicClient.readContract({ address: pass.registry, abi: permissionedRegistryAbi, functionName: "getState", args: [labelId(pass.label)] });
        await simulate(device.signer, { address: pass.registry, abi: permissionedRegistryAbi, functionName: "safeTransferFrom", args: [device.signer.address, ATTACKER_ADDRESS, st.tokenId, 1n, "0x"] });
      },
    },
    {
      key: "cap",
      label: "Raise my own limit",
      run: async () => simulate(device.signer, { address: pass.resolver, abi: permissionedResolverAbi, functionName: "setData", args: [await node(), "pass.scope", "0x01"] }),
    },
    ...(canRefund
      ? [
          {
            key: "self",
            label: "Refund money to my own wallet",
            run: () => simulate(device.signer, { address: gate, abi: shiftGateAbi, functionName: "refund", args: [pass.label, randomId(), 1_000_000n] }),
          },
        ]
      : []),
    ...(canRefund && bigOrder
      ? [
          {
            key: "over",
            label: `Refund ${usdc(remaining + 1_000_000n)} — over my limit`,
            run: () => simulate(device.signer, { address: gate, abi: shiftGateAbi, functionName: "refund", args: [pass.label, bigOrder.orderId, remaining + 1_000_000n] }),
          },
        ]
      : []),
  ];

  return (
    <div className="stack" style={{ gap: 20 }}>
      {pass.sandbox && <PlayJourney />}
      <PassCard pass={pass} preset={preset} />

      {pass.sandbox && loop?.orderId && !loop.refundedAt && live && canRefund && (
        <Group pad>
          <p className="small secondary" style={{ margin: 0 }}>
            Playground order ready. Tap Refund — the code is prefilled. Money returns only to the wallet that paid.
          </p>
          <Button block variant="primary" icon={CircleDollarSign} disabled={busy !== null} onClick={() => setSheet("refund")} style={{ marginTop: 10 }}>
            Refund sandbox order
          </Button>
        </Group>
      )}

      {pass.sandbox && loop?.refundedAt && (
        <Group pad>
          <p className="small secondary" style={{ margin: 0 }}>
            Refund confirmed. Public Check should say DEMO for {pass.name}.
          </p>
          <div className="play-actions" style={{ marginTop: 10 }}>
            <Button variant="primary" icon={BadgeCheck} onClick={() => navigate("verify", { name: pass.name })}>
              Next · Public check
            </Button>
            <Button icon={FlaskConical} onClick={() => navigate("try")}>
              Playground
            </Button>
          </div>
        </Group>
      )}

      {live ? (
        <>
          {pass.cap > 0n && (
            <div>
              <div className="row spread small secondary" style={{ marginBottom: 6 }}>
                <span>Used {usdc(pass.spent)}</span>
                <span>{usdc(remaining)} left of {usdc(pass.cap)}</span>
              </div>
              <Meter value={pass.spent} max={pass.cap} />
            </div>
          )}
          <div className="action-grid">
            <button className="action-tile" disabled={!canRefund || busy !== null} onClick={() => setSheet("refund")}>
              <CircleDollarSign size={24} color="var(--orange-solid)" />
              Refund
            </button>
            <button className="action-tile" disabled={!canCheckIn || busy !== null} onClick={() => setSheet("checkin")}>
              <Ticket size={24} color="var(--green-solid)" />
              Check In
            </button>
            <button className="action-tile" disabled={busy !== null} onClick={() => setSheet("status")}>
              <MessageSquare size={24} color="var(--blue)" />
              Status
            </button>
          </div>
          {pass.shiftStatus && <p className="small secondary" style={{ textAlign: "center" }}>Showing as “{pass.shiftStatus}”</p>}
        </>
      ) : (
        <Group pad>
          <div style={{ fontWeight: 600 }}>
            {pass.state === "revoked" ? "Your lead revoked this pass." : pass.state === "killed" ? "All passes were stopped for an incident." : `Your shift ended at ${clock(pass.expiry)}.`}
          </div>
          <p className="small secondary" style={{ margin: "4px 0 12px" }}>
            Ask your shift lead for a new pass. Nobody had to switch this one off — it stopped by itself.
          </p>
          {canRefund && (
            <Button
              onClick={() =>
                probe("late", "Refund after the shift", () =>
                  simulate(device.signer, { address: gate, abi: shiftGateAbi, functionName: "refund", args: [pass.label, randomId(), 1_000_000n] }),
                )
              }
            >
              Try a Refund Anyway
            </Button>
          )}
          {probes.late && <p className="small" style={{ marginTop: 10, color: probes.late.blocked ? "var(--green)" : "var(--red)" }}>{probes.late.blocked ? "Refused: " : ""}{probes.late.why}</p>}
        </Group>
      )}

      <Group title="This pass can">
        <Row icon={Check} tint="green" title="Update its status note" plain />
        {canRefund && <Row icon={Check} tint="green" title={`Refund paid orders, up to ${usdc(pass.cap)} in total`} plain />}
        {canCheckIn && <Row icon={Check} tint="green" title="Check in tickets" plain />}
        <Row icon={Lock} tint="soft" title="Choose who a refund goes to" plain />
        <Row icon={Lock} tint="soft" title="Change where payouts go" plain />
        <Row icon={Lock} tint="soft" title="Transfer, sell or lend the pass" plain />
        <Row icon={Lock} tint="soft" title="Extend the shift or raise the limit" plain />
      </Group>

      {live && (
        <Group title="Security Check" footer="What a rogue holder or a stolen phone would try. Each attempt is checked against the chain without spending gas.">
          {PROBES.map((p) => {
            const r = probes[p.key];
            return (
              <Row
                key={p.key}
                icon={r ? (r.blocked ? ShieldCheck : ShieldX) : ShieldCheck}
                tint={r ? (r.blocked ? "green" : "red") : "soft"}
                title={p.label}
                subtitle={r ? (r.blocked ? `Blocked — ${r.why}` : r.why) : "Tap to try"}
                onClick={() => probe(p.key, p.label, p.run)}
              />
            );
          })}
        </Group>
      )}

      {history.length > 0 && (
        <Group title="Earlier passes">
          {history.slice(0, 5).map((h) => (
            <Row key={h.index} title={h.label} subtitle={`${s.presets[h.presetId]?.name} · ended ${clock(h.expiry)}`} trailing={h.spent > 0n ? usdc(h.spent) : undefined} plain />
          ))}
        </Group>
      )}

      {sheet && (
        <Sheet onClose={() => setSheet(null)}>
          {sheet === "refund" && (
            <>
              <div className="sheet-title">Refund a Customer</div>
              <p className="secondary small" style={{ margin: "6px 0 18px" }}>
                {usdc(remaining)} left on this pass. The money goes back to the wallet that paid the order, in {isLocal ? "USDC" : "test USDC"}.
              </p>
              {openOrders.length > 0 && (
                <div className="stack-sm" style={{ marginBottom: 14 }}>
                  <div className="small secondary">Recent paid orders</div>
                  {openOrders.slice(0, 4).map((o) => (
                    <button
                      key={o.orderId}
                      className={`list-row plain ${o.orderId === orderCode ? "selected" : ""}`}
                      style={{ borderRadius: 10 }}
                      onClick={() => {
                        setOrderCode(o.orderId);
                        const left = o.paid - o.refunded;
                        if (amountUnits > left) setAmount(String(Number(left) / 1e6));
                      }}
                    >
                      <div className="row-main">
                        <div className="row-title">{usdc(o.paid - o.refunded)} refundable</div>
                        <div className="row-sub mono">
                          {o.orderId.slice(0, 10)}… · paid by {short(o.payer)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <Field
                label="Order code"
                hint={
                  !orderCode
                    ? "From the customer's receipt. The refund goes to the wallet that paid it."
                    : !codeOk
                      ? "An order code is 0x followed by 64 hex characters."
                      : order
                        ? `Paid ${usdc(order.paid)} by ${short(order.payer)}. ${usdc(order.paid - order.refunded)} left to refund.`
                        : "Not in the recent orders. The gate will check it."
                }
              >
                <input className="input mono" placeholder="0x…" value={orderCode} onChange={(e) => setOrderCode(e.target.value.trim())} />
              </Field>
              <Field label="Amount">
                <div className="affix">
                  <input className="input input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus />
                  <span className="suffix">{isLocal ? "USDC" : "test USDC"}</span>
                </div>
              </Field>
            </>
          )}
          {sheet === "checkin" && (
            <>
              <div className="sheet-title">Check In a Ticket</div>
              <p className="secondary small" style={{ margin: "6px 0 18px" }}>Each ticket can only be checked in once.</p>
              <Field label="Ticket code">
                <input className="input input-lg" value={ticket} onChange={(e) => setTicket(e.target.value)} autoFocus />
              </Field>
            </>
          )}
          {sheet === "status" && (
            <>
              <div className="sheet-title">Update Status</div>
              <p className="secondary small" style={{ margin: "6px 0 18px" }}>Shown to anyone who checks your pass. It's the only record you can change.</p>
              <Field label="Status">
                <input className="input input-lg" placeholder="e.g. Lane 3, back in 5" value={status} onChange={(e) => setStatus(e.target.value)} autoFocus />
              </Field>
            </>
          )}
          <div className="row" style={{ marginTop: 20 }}>
            <Button block onClick={() => setSheet(null)}>
              Cancel
            </Button>
            <Button
              block
              variant="primary"
              disabled={(sheet === "refund" && (amountUnits <= 0n || !codeOk)) || (sheet === "checkin" && !ticket) || (sheet === "status" && !status)}
              onClick={() => act(sheet)}
            >
              {sheet === "refund" ? "Refund" : sheet === "checkin" ? "Check In" : "Update"}
            </Button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
