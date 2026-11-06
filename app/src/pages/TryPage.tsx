import { useEffect, useState } from "react";
import { isAddress, parseEventLogs, type Address } from "viem";
import { BadgeCheck, CreditCard, FlaskConical, Smartphone, Wallet, XOctagon } from "lucide-react";
import { Button, Countdown, Field, Group, NetworkNote, Row, Segmented, StateBadge } from "../components/ui";
import { useOnShift } from "../lib/onshift";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { publicClient } from "../lib/clients";
import { deployment, GAS_DRIP_WEI, isLocal } from "../lib/config";
import { sameAddress, short, toUsdcUnits, usdc } from "../lib/format";
import { playgroundAbi } from "../generated/abis";
import { ThemeToggle, navigate } from "../App";

const MAX_CAP = 5;
const MAX_PER_DAY = 3;
const DURATIONS = [
  { value: "900", label: "15 min" },
  { value: "1800", label: "30 min" },
  { value: "3600", label: "1 hour" },
];

/** Playground: any wallet acts as a shift lead with tight limits, on the live deployment. */
export function TryPage() {
  const { snapshot } = useOnShift();
  const { operator, connectWallet, devices, addDevice, setDevice, run, busy, notify } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const me = operator?.signer.address;

  const presets = s.presets.filter((p) => p.active && (p.name === "Cashier" || p.agent || p.name === "Door staff"));
  const [presetId, setPresetId] = useState(presets[0]?.id ?? 0);
  const [seconds, setSeconds] = useState("1800");
  const [cap, setCap] = useState(String(MAX_CAP));
  const [holderChoice, setHolderChoice] = useState<"new" | "paste">("new");
  const [pasted, setPasted] = useState("");
  const [triesLeft, setTriesLeft] = useState<number>();
  const [justIssued, setJustIssued] = useState<string>();

  const preset = s.presets[presetId];
  const capUnits = (() => {
    try {
      return toUsdcUnits(cap);
    } catch {
      return -1n;
    }
  })();
  const effectiveCap = preset && preset.maxCap === 0n ? 0n : capUnits;
  const capOk = effectiveCap >= 0n && effectiveCap <= BigInt(MAX_CAP * 1e6) && effectiveCap <= (preset?.maxCap ?? 0n);
  const mine = s.passes.filter((p) => sameAddress(p.requester, me));

  useEffect(() => {
    if (!me || !d.playground) return setTriesLeft(undefined);
    const day = BigInt(Math.floor(s.blockTs / 86400));
    publicClient
      .readContract({ address: d.playground, abi: playgroundAbi, functionName: "triesOnDay", args: [me, day] })
      .then((n) => setTriesLeft(Math.max(0, MAX_PER_DAY - Number(n))))
      .catch(() => setTriesLeft(undefined));
  }, [me, d.playground, s.blockTs, mine.length]);

  if (!d.playground) {
    return (
      <Shell>
        <Group pad>This deployment has no Playground.</Group>
      </Shell>
    );
  }

  const issue = async () => {
    if (!operator || !me) return;
    try {
      const balance = await publicClient.getBalance({ address: me });
      if (!isLocal && balance < GAS_DRIP_WEI + 2_000_000_000_000_000n) {
        notify({ tone: "error", title: "Not enough Sepolia ETH", detail: "You need about 0.005 Sepolia ETH: gas for the pass plus a 0.003 ETH allowance for the holder." });
        return;
      }
    } catch {
      /* the send below reports the real problem */
    }
    const holderDevice = holderChoice === "new" ? addDevice(`${preset?.agent ? "Agent" : "Staff phone"} ${devices.length + 1}`, preset?.agent ? "agent" : "staff") : undefined;
    const holder: Address | undefined = holderDevice ? holderDevice.signer.address : isAddress(pasted) ? (pasted as Address) : undefined;
    if (!holder) return;
    let label = "";
    const ok = await run(
      "try",
      async () => {
        const receipt = await send(operator.signer, {
          address: d.playground!,
          abi: playgroundAbi,
          functionName: "tryIt",
          args: [holder, presetId, BigInt(seconds), effectiveCap, preset?.agent ? "Playground agent: small refunds only." : ""],
          value: GAS_DRIP_WEI,
        });
        const [tried] = parseEventLogs({ abi: playgroundAbi, logs: receipt.logs, eventName: "Tried" });
        label = tried?.args.label ?? "";
        return receipt;
      },
      "Pass issued",
      "A real ENSv2 name with its own resolver and no transfer rights.",
    );
    if (ok && label) {
      setJustIssued(label);
      if (holderDevice) setDevice(holderDevice.id);
    }
  };

  const revoke = (label: string) =>
    run("revoke", () => send(operator!.signer, { address: d.playground!, abi: playgroundAbi, functionName: "revoke", args: [label] }), "Pass ended", `${label}.ops.${d.orgName} no longer verifies.`);

  return (
    <Shell>
      <div style={{ textAlign: "center", padding: "12px 0 0" }}>
        <h1 className="large-title">Try OnShift</h1>
        <p className="page-sub">
          Be a shift lead for a minute. Issue a real pass on {d.orgName}, use it on a staff device, then watch it stop by itself. Playground passes last up to an hour and can refund up to ${MAX_CAP}.
        </p>
      </div>

      {!me ? (
        <Group pad>
          <div className="stack-sm" style={{ textAlign: "center" }}>
            <p className="secondary small">Connect a wallet with a little Sepolia ETH.</p>
            <Button variant="primary" icon={Wallet} onClick={() => connectWallet()}>
              Connect Wallet
            </Button>
          </div>
        </Group>
      ) : (
        <>
          <Group title="1. Role">
            {presets.map((p) => (
              <Row
                key={p.id}
                icon={p.agent ? FlaskConical : p.maxCap === 0n ? BadgeCheck : CreditCard}
                tint={presetId === p.id ? "blue" : "soft"}
                title={p.name}
                subtitle={p.maxCap === 0n ? "Checks tickets. Cannot move money." : `Refunds paid orders, up to $${MAX_CAP} here`}
                selected={presetId === p.id}
                onClick={() => setPresetId(p.id)}
              />
            ))}
          </Group>

          <Group title="2. Limits" pad>
            <Field label="Shift length">
              <Segmented value={seconds} options={DURATIONS} onChange={setSeconds} block />
            </Field>
            {preset && preset.maxCap > 0n && (
              <Field label="Refund cap" hint={capOk ? undefined : `Between 0 and ${MAX_CAP} test USDC.`}>
                <div className="affix">
                  <input className="input" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <span className="suffix">test USDC</span>
                </div>
              </Field>
            )}
          </Group>

          <Group title="3. Who gets it">
            <Row icon={Smartphone} tint={holderChoice === "new" ? "blue" : "soft"} title="A new device in this browser" subtitle="Creates a key here, then opens the staff app" selected={holderChoice === "new"} onClick={() => setHolderChoice("new")} />
            <Row icon={Wallet} tint={holderChoice === "paste" ? "blue" : "soft"} title="Another wallet" subtitle="Paste an address, e.g. a second phone's device code" selected={holderChoice === "paste"} onClick={() => setHolderChoice("paste")} />
          </Group>
          {holderChoice === "paste" && (
            <Field label="Holder address">
              <input className="input mono" placeholder="0x…" value={pasted} onChange={(e) => setPasted(e.target.value.trim())} />
            </Field>
          )}

          <Button block size="lg" variant="primary" loading={busy === "try"} disabled={busy !== null || !capOk || triesLeft === 0 || (holderChoice === "paste" && !isAddress(pasted))} onClick={issue}>
            Issue Pass
          </Button>
          <p className="small secondary" style={{ textAlign: "center", marginTop: -8 }}>
            {triesLeft === undefined ? "" : `${triesLeft} of ${MAX_PER_DAY} left today. `}Sends 0.003 Sepolia ETH to the holder for gas.
          </p>

          {justIssued && (
            <Group pad>
              <div className="stack-sm" style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700 }}>{justIssued}.ops.{d.orgName} is live</div>
                <div className="row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
                  <Button variant="primary" icon={Smartphone} onClick={() => navigate("device")}>
                    Open Staff App
                  </Button>
                  <Button icon={CreditCard} onClick={() => navigate("pay")}>
                    Pay as a Customer
                  </Button>
                  <Button icon={BadgeCheck} onClick={() => navigate("verify", { name: `${justIssued}.ops.${d.orgName}` })}>
                    Check It Publicly
                  </Button>
                </div>
              </div>
            </Group>
          )}

          {mine.length > 0 && (
            <Group title="Your Playground passes">
              {mine.slice(0, 6).map((p) => (
                <Row
                  key={p.index}
                  title={p.name}
                  subtitle={
                    <span>
                      {s.presets[p.presetId]?.name} · held by {short(p.holder)}
                      {p.state === "live" && (
                        <>
                          {" · "}
                          <Countdown expiry={p.expiry} />
                        </>
                      )}
                      {p.cap > 0n && ` · ${usdc(p.spent)} of ${usdc(p.cap)} used`}
                    </span>
                  }
                  trailing={
                    p.state === "live" ? (
                      <Button variant="plain danger" icon={XOctagon} disabled={busy !== null} onClick={() => revoke(p.label)}>
                        End
                      </Button>
                    ) : (
                      <StateBadge state={p.state} />
                    )
                  }
                  plain
                />
              ))}
            </Group>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="device-shell">
      <NetworkNote compact />
      <div className="device">
        <div className="device-bar">
          <span className="btn" style={{ pointerEvents: "none" }}>
            <FlaskConical size={15} /> Playground
          </span>
          <div className="row">
            <ThemeToggle />
            <Button variant="plain" onClick={() => navigate("home")}>
              Home
            </Button>
          </div>
        </div>
        <div className="stack" style={{ gap: 18 }}>{children}</div>
      </div>
    </div>
  );
}
