import { useState } from "react";
import { keccak256, toHex, type Hex } from "viem";
import {
  Bot,
  Check,
  CircleDollarSign,
  Clock3,
  Lock,
  MessageSquare,
  Plus,
  ShieldCheck,
  ShieldX,
  Smartphone,
  Ticket,
  Trash2,
} from "lucide-react";
import { Button, CopyButton, Empty, Field, Group, Meter, Qr, Row, Sheet } from "../components/ui";
import { PassCard } from "../components/PassCard";
import { labelId, passNode, useOnShift, type PassRow } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send, simulate } from "../lib/tx";
import { explain } from "../lib/errors";
import { publicClient } from "../lib/clients";
import { ACTION_CHECK_IN, ACTION_REFUND, deployment } from "../lib/config";
import { ATTACKER_ADDRESS, CUSTOMER_ADDRESS, type Device } from "../lib/identities";
import { clock, sameAddress, short, toUsdcUnits, usdc } from "../lib/format";
import { permissionedRegistryAbi, permissionedResolverAbi, shiftGateAbi } from "../generated/abis";
import { ThemeToggle, navigate } from "../App";

const randomId = (): Hex => keccak256(toHex(`${Date.now()}-${Math.random()}`));

export function DeviceApp() {
  const { devices, device, setDevice, addDevice } = useSession();
  const [picking, setPicking] = useState(false);

  return (
    <div className="device-shell">
      <div className="device">
        <div className="device-bar">
          <button className="btn" onClick={() => setPicking(true)}>
            {device?.kind === "agent" ? <Bot size={15} /> : <Smartphone size={15} />}
            {device ? device.name : "Choose device"}
          </button>
          <div className="row">
            <ThemeToggle />
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
            They scan it to give this {device.kind === "agent" ? "agent" : "phone"} a pass. No account, no password, no seed phrase.
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
  const preset = s.presets[pass.presetId];
  const live = pass.state === "live";
  const canRefund = (preset?.actions & ACTION_REFUND) !== 0;
  const canCheckIn = (preset?.actions & ACTION_CHECK_IN) !== 0;
  const remaining = pass.cap - pass.spent;

  const [sheet, setSheet] = useState<"refund" | "checkin" | "status" | null>(null);
  const [amount, setAmount] = useState("10");
  const [ticket, setTicket] = useState("TKT-1042");
  const [status, setStatus] = useState("");
  const [probes, setProbes] = useState<Record<string, Probe>>({});

  const node = async () => passNode(pass.label);

  const act = async (key: "refund" | "checkin" | "status") => {
    setSheet(null);
    if (key === "refund")
      await run(
        "refund",
        () => send(device.signer, { address: d.shiftGate, abi: shiftGateAbi, functionName: "refund", args: [pass.label, CUSTOMER_ADDRESS, toUsdcUnits(amount), randomId()] }),
        `Refunded ${usdc(toUsdcUnits(amount))}`,
        "Paid to the customer from the payment gate.",
      );
    if (key === "checkin")
      await run(
        "checkin",
        () => send(device.signer, { address: d.shiftGate, abi: shiftGateAbi, functionName: "checkIn", args: [pass.label, keccak256(toHex(ticket))] }),
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
            key: "over",
            label: `Refund ${usdc(remaining + 1_000_000n)} — over my limit`,
            run: () => simulate(device.signer, { address: d.shiftGate, abi: shiftGateAbi, functionName: "refund", args: [pass.label, ATTACKER_ADDRESS, remaining + 1_000_000n, randomId()] }),
          },
        ]
      : []),
  ];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PassCard pass={pass} preset={preset} />

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
                  simulate(device.signer, { address: d.shiftGate, abi: shiftGateAbi, functionName: "refund", args: [pass.label, CUSTOMER_ADDRESS, 1_000_000n, randomId()] }),
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
        {canRefund && <Row icon={Check} tint="green" title={`Refund customers, up to ${usdc(pass.cap)} in total`} plain />}
        {canCheckIn && <Row icon={Check} tint="green" title="Check in tickets" plain />}
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
                {usdc(remaining)} left on this pass. The money comes from {d.orgName}'s payment gate, not from you.
              </p>
              <Field label="Amount">
                <div className="affix">
                  <input className="input input-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} autoFocus />
                  <span className="suffix">USDC</span>
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
              disabled={(sheet === "refund" && !Number(amount)) || (sheet === "checkin" && !ticket) || (sheet === "status" && !status)}
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
