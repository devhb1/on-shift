import { useEffect, useState, useSyncExternalStore } from "react";
import { isAddress, parseEventLogs, type Address } from "viem";
import { BadgeCheck, CreditCard, FlaskConical, Smartphone, Wallet, XOctagon } from "lucide-react";
import { Button, Countdown, Field, Group, NetworkNote, Row, Segmented, StateBadge } from "../components/ui";
import { PlayJourney } from "../components/PlayJourney";
import { useOnShift } from "../lib/onshift";
import { getPlayLoop, setPlayIssued, subscribePlayLoop } from "../lib/playLoop";
import { useSession } from "../lib/session";
import { send } from "../lib/tx";
import { publicClient } from "../lib/clients";
import { deployment, explorerTx, GAS_DRIP_WEI, isLocal } from "../lib/config";
import { sameAddress, short, toUsdcUnits, usdc } from "../lib/format";
import { playgroundAbi } from "../generated/abis";
import { passPreset } from "./shared";
import { ThemeToggle, navigate } from "../App";

const MAX_CAP = 5;
const MAX_PER_DAY = 3;
const DURATIONS = [
  { value: "900", label: "15 min" },
  { value: "1800", label: "30 min" },
  { value: "3600", label: "1 hour" },
];

/** Playground: anyone can mint a *demo* pass under demo.<org> — never ops staff roles. */
const DEMO_PRESETS = [
  { id: 0, name: "Demo cashier", agent: false, maxCap: BigInt(MAX_CAP * 1e6) },
  { id: 1, name: "Demo agent", agent: true, maxCap: BigInt(MAX_CAP * 1e6) },
] as const;

export function TryPage() {
  const { snapshot } = useOnShift();
  const { operator, connectWallet, devices, addDevice, setDevice, run, busy, notify } = useSession();
  const s = snapshot!;
  const d = deployment!;
  const me = operator?.signer.address;

  const presets = DEMO_PRESETS;
  const agentPreset = presets.find((p) => p.agent);
  const [presetId, setPresetId] = useState(agentPreset?.id ?? 0);
  const [seconds, setSeconds] = useState("1800");
  const [cap, setCap] = useState(String(MAX_CAP));
  const [holderChoice, setHolderChoice] = useState<"new" | "paste">("new");
  const [pasted, setPasted] = useState("");
  const [triesLeft, setTriesLeft] = useState<number>();
  const [justIssued, setJustIssued] = useState<{ label: string; hash: string; block: string }>();
  const loop = useSyncExternalStore(subscribePlayLoop, getPlayLoop, () => undefined);

  const preset = presets.find((p) => p.id === presetId) ?? presets[0];
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
  const demoSuffix = `.demo.${d.orgName}`;

  useEffect(() => {
    if (!me || !d.playground) return setTriesLeft(undefined);
    const day = BigInt(Math.floor(s.blockTs / 86400));
    publicClient
      .readContract({ address: d.playground, abi: playgroundAbi, functionName: "triesOnDay", args: [me, day] })
      .then((n) => setTriesLeft(Math.max(0, MAX_PER_DAY - Number(n))))
      .catch(() => setTriesLeft(undefined));
  }, [me, d.playground, s.blockTs, mine.length]);

  useEffect(() => {
    if (loop?.name || !me) return;
    const live = s.passes.find((p) => p.sandbox && p.state === "live" && sameAddress(p.requester, me));
    if (live) setPlayIssued({ label: live.label, name: live.name });
  }, [loop?.name, me, s.passes]);

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
    let issued: { label: string; hash: string; block: string } | undefined;
    const ok = await run(
      "try",
      async () => {
        const receipt = await send(operator.signer, {
          address: d.playground!,
          abi: playgroundAbi,
          functionName: "tryIt",
          args: [holder, presetId, BigInt(seconds), effectiveCap],
          value: GAS_DRIP_WEI,
        });
        const [tried] = parseEventLogs({ abi: playgroundAbi, logs: receipt.logs, eventName: "Tried" });
        issued = {
          label: tried?.args.label ?? "",
          hash: receipt.transactionHash,
          block: receipt.blockNumber.toString(),
        };
        return receipt;
      },
      "Demo pass issued",
      `Mined on Sepolia. The name ends in ${demoSuffix}. The transaction link is the proof.`,
    );
    if (ok && issued?.label) {
      setJustIssued(issued);
      setPlayIssued({
        label: issued.label,
        name: `${issued.label}${demoSuffix}`,
        hash: issued.hash,
        block: issued.block,
      });
      if (holderDevice) setDevice(holderDevice.id);
    }
  };

  const revoke = (label: string) =>
    run("revoke", () => send(operator!.signer, { address: d.playground!, abi: playgroundAbi, functionName: "revoke", args: [label] }), "Pass ended", `${label}${demoSuffix} no longer verifies.`);

  const issuedName = justIssued?.label ? `${justIssued.label}${demoSuffix}` : loop?.name;
  const issuedTx = (justIssued?.hash ?? loop?.hash) ? explorerTx(justIssued?.hash ?? loop?.hash ?? "") : "";
  const issuedBlock = justIssued?.block ?? loop?.block;
  const canIssue = busy === null && capOk && triesLeft !== 0 && (holderChoice === "new" || isAddress(pasted));
  const livePass = mine.find((p) => p.state === "live") ?? s.passes.find((p) => p.sandbox && p.state === "live");
  const nextName = issuedName ?? livePass?.name;

  return (
    <Shell>
      <div className="play-head">
        <div>
          <h1 className="large-title">Try OnShift</h1>
          <p className="page-sub">A sandbox name under demo.{d.orgName}. It cannot touch the production till. Up to an hour, up to ${MAX_CAP}.</p>
        </div>
      </div>
      <PlayJourney />

      <div className="play-grid">
          <div className="play-card">
            {!me ? (
              <div className="stack-sm" style={{ textAlign: "center", padding: "8px 0" }}>
                <p className="secondary small">Connect a wallet with a little Sepolia ETH. About 0.005 covers gas and the holder's allowance.</p>
                <Button variant="primary" icon={Wallet} onClick={() => connectWallet()}>
                  Connect Wallet
                </Button>
              </div>
            ) : (
              <>
            <div className="play-label">Role</div>
            <div className="play-choices">
              {presets.map((p) => (
                <button key={p.id} type="button" className={`play-choice ${presetId === p.id ? "on" : ""}`} onClick={() => setPresetId(p.id)}>
                  <span className="play-choice-title">{p.agent ? <FlaskConical size={14} /> : <CreditCard size={14} />} {p.name}</span>
                  <span className="play-choice-sub">Refunds on the sandbox till, up to ${MAX_CAP}</span>
                </button>
              ))}
            </div>

            <div className="play-split">
              <Field label="Shift length">
                <Segmented value={seconds} options={DURATIONS} onChange={setSeconds} block />
              </Field>
              <Field label="Refund cap" hint={capOk ? undefined : `0 to ${MAX_CAP}`}>
                <div className="affix">
                  <input className="input" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^0-9.]/g, ""))} />
                  <span className="suffix">test USDC</span>
                </div>
              </Field>
            </div>

            <div className="play-label">Who holds it</div>
            <div className="play-choices">
              <button type="button" className={`play-choice ${holderChoice === "new" ? "on" : ""}`} onClick={() => setHolderChoice("new")}>
                <span className="play-choice-title"><Smartphone size={14} /> This browser</span>
                <span className="play-choice-sub">New key, then the staff app</span>
              </button>
              <button type="button" className={`play-choice ${holderChoice === "paste" ? "on" : ""}`} onClick={() => setHolderChoice("paste")}>
                <span className="play-choice-title"><Wallet size={14} /> Another wallet</span>
                <span className="play-choice-sub">Paste a device code</span>
              </button>
            </div>
            {holderChoice === "paste" && (
              <Field label="Holder address">
                <input className="input mono" placeholder="0x…" value={pasted} onChange={(e) => setPasted(e.target.value.trim())} />
              </Field>
            )}

            <Button block size="lg" variant="primary" loading={busy === "try"} disabled={!canIssue} onClick={issue}>
              Issue Pass
            </Button>
            <p className="small secondary" style={{ textAlign: "center", margin: "8px 0 0" }}>
              {triesLeft === undefined ? "" : `${triesLeft} of ${MAX_PER_DAY} left today. `}Sends 0.003 Sepolia ETH to the holder for gas.
            </p>
              </>
            )}
          </div>

          <div className="play-side">
            <div className="play-card">
              {nextName ? (
                <div className="stack-sm">
                  <div className="play-label">{issuedBlock ? `Mined · block ${issuedBlock}` : "Next in the loop"}</div>
                  <div className="play-name">{nextName}</div>
                  {issuedTx && (
                    <a className="play-tx" href={issuedTx} target="_blank" rel="noreferrer">
                      View transaction ↗
                    </a>
                  )}
                  {loop?.orderId && !loop.refundedAt && (
                    <p className="small secondary">Sandbox order ready. Open the staff app and refund it — money returns only to the payer.</p>
                  )}
                  {loop?.refundedAt && (
                    <p className="small secondary">Refunded. Public Check this name — it should say DEMO, not staff.</p>
                  )}
                  {!loop?.orderId && (
                    <ol className="play-steps">
                      <li>Pay the sandbox till (same wallet or another).</li>
                      <li>Staff app refunds that order. Payer is fixed on chain.</li>
                      <li>Public Check this name. It should say demo, not staff.</li>
                    </ol>
                  )}
                  <div className="play-actions">
                    {!loop?.orderId && (
                      <Button variant="primary" icon={CreditCard} onClick={() => navigate("pay", { demo: "1" })}>
                        Next · Pay sandbox
                      </Button>
                    )}
                    {loop?.orderId && !loop.refundedAt && (
                      <Button variant="primary" icon={Smartphone} onClick={() => navigate("device")}>
                        Next · Refund in staff app
                      </Button>
                    )}
                    {loop?.refundedAt && (
                      <Button variant="primary" icon={BadgeCheck} onClick={() => navigate("verify", { name: nextName })}>
                        Next · Public check
                      </Button>
                    )}
                    <Button icon={Smartphone} onClick={() => navigate("device")}>
                      Staff app
                    </Button>
                    <Button icon={BadgeCheck} onClick={() => navigate("verify", { name: nextName })}>
                      Public check
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="stack-sm">
                  <div className="play-label">The loop, on one screen</div>
                  <ol className="play-steps">
                    <li>Issue a demo pass. The name ends in demo.{d.orgName}.</li>
                    <li>Pay the sandbox till. That order is not a production payment.</li>
                    <li>Refund it from the staff app. The money can only return to the payer.</li>
                    <li>Public Check reads the same name. A look-alike org is flagged.</li>
                  </ol>
                  {triesLeft === 0 && (
                    <p className="small secondary">Daily issue limit reached. Use a live pass below, or wait for the next UTC day.</p>
                  )}
                </div>
              )}
            </div>

            {mine.length > 0 && (
              <Group title="Your sandbox passes">
                {mine.slice(0, 4).map((p) => (
                  <Row
                    key={p.index}
                    title={p.name}
                    subtitle={
                      <span>
                        {passPreset(s, p)?.name ?? "Demo"} · {short(p.holder)}
                        {p.state === "live" && (
                          <>
                            {" · "}
                            <Countdown expiry={p.expiry} />
                          </>
                        )}
                        {p.cap > 0n && ` · ${usdc(p.spent)} of ${usdc(p.cap)}`}
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
                    onClick={() => navigate("verify", { name: p.name })}
                    plain
                  />
                ))}
              </Group>
            )}
          </div>
        </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="play-shell">
      <NetworkNote compact />
      <div className="device-bar">
        <span className="btn" style={{ pointerEvents: "none", gap: 8 }}>
          <img src="/brand/onshift-mark.svg" width={22} height={22} alt="" style={{ borderRadius: 6 }} />
          Playground
        </span>
        <div className="row">
          <ThemeToggle />
          <Button variant="plain" onClick={() => navigate("how")}>
              How it works
            </Button>
          <Button variant="plain" onClick={() => navigate("home")}>
              Home
            </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
