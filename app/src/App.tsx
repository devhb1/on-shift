import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  CreditCard,
  FlaskConical,
  LayoutGrid,
  ListChecks,
  Moon,
  Plus,
  Server,
  ShieldCheck,
  Smartphone,
  Sun,
  Users,
  Wallet,
} from "lucide-react";
import { useOnShift } from "./lib/onshift";
import { useSession } from "./lib/session";
import { deployment, isLocal, networkLabel } from "./lib/config";
import { short } from "./lib/format";
import { useTheme } from "./lib/theme";
import { BrandMark } from "./components/BrandMark";
import { Badge, NetworkNote, Toasts } from "./components/ui";
import { Overview } from "./pages/Overview";
import { Passes } from "./pages/Passes";
import { NewPass } from "./pages/NewPass";
import { Team } from "./pages/Team";
import { Security } from "./pages/Security";
import { ActivityPage } from "./pages/ActivityPage";
import { DeploymentPage } from "./pages/DeploymentPage";
import { DeviceApp } from "./pages/DeviceApp";
import { Verify } from "./pages/Verify";
import { Setup } from "./pages/Setup";
import { PayPage } from "./pages/PayPage";
import { TryPage } from "./pages/TryPage";
import { Home } from "./pages/Home";
import { How } from "./pages/How";

export type Route = "overview" | "passes" | "new" | "team" | "security" | "activity" | "deployment" | "device" | "verify" | "pay" | "try" | "home" | "how";

const CONSOLE: { group: string; items: { id: Route; label: string; icon: typeof Activity }[] }[] = [
  {
    group: "Operations",
    items: [
      { id: "overview", label: "Overview", icon: LayoutGrid },
      { id: "passes", label: "Passes", icon: ListChecks },
      { id: "new", label: "New Pass", icon: Plus },
    ],
  },
  {
    group: "Organization",
    items: [
      { id: "team", label: "Team & Roles", icon: Users },
      { id: "security", label: "Security", icon: ShieldCheck },
    ],
  },
  {
    group: "Records",
    items: [
      { id: "activity", label: "Activity", icon: Activity },
      { id: "deployment", label: "Deployment", icon: Server },
    ],
  },
];

const ROUTES: Route[] = ["overview", "passes", "new", "team", "security", "activity", "deployment", "device", "verify", "pay", "try", "home", "how"];

function parseHash(): { route: Route; params: URLSearchParams } {
  const [path, query] = window.location.hash.replace(/^#\/?/, "").split("?");
  const route = (ROUTES as string[]).includes(path) ? (path as Route) : "home";
  return { route, params: new URLSearchParams(query ?? "") };
}

const TRAIL_KEY = "onshift.navTrail";
let applyingBack = false;

function readTrail(): string[] {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TRAIL_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeTrail(trail: string[]) {
  try {
    sessionStorage.setItem(TRAIL_KEY, JSON.stringify(trail.slice(-16)));
  } catch {
    /* private mode */
  }
}

export function navigate(route: Route, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params)}` : "";
  const next = `/${route}${q}`;
  const cur = window.location.hash || "#/home";
  if (!applyingBack && cur !== `#${next}`) {
    const trail = readTrail();
    trail.push(cur);
    writeTrail(trail);
  }
  if (cur !== `#${next}`) window.location.hash = next;
}

/** Return to the screen you opened this one from. Falls back to Home. */
export function goBack() {
  const trail = readTrail();
  const prev = trail.pop();
  writeTrail(trail);
  applyingBack = true;
  window.location.hash = prev ? prev.replace(/^#/, "") : "/home";
  window.setTimeout(() => {
    applyingBack = false;
  }, 0);
}

const FLOW_STEPS: { route: Route; label: string; params?: Record<string, string> }[] = [
  { route: "overview", label: "Admin" },
  { route: "try", label: "1 · Issue" },
  { route: "pay", label: "2 · Pay", params: { demo: "1" } },
  { route: "device", label: "3 · Pass" },
  { route: "verify", label: "4 · Check" },
];

const FLOW_HINT: Partial<Record<Route, string>> = {
  try: "Any wallet, not the org key. Issue creates play-….demo.onshift.eth. It cannot touch the production till.",
  pay: "Customer wallet. Add test USDC and pay. Leave this tab open — the order code is what the pass refunds.",
  device: "The staff pass. Refund the order you just paid. The QR opens Public Check. The steps above always take you back.",
  verify: "No wallet. Paste the name, or Scan the QR on the staff pass. On shift is registry state, not “the name resolves.”",
  how: "Three doors in the demo: the admin wallet, any other wallet, and a public check with no account.",
};

const CONSOLE_ROUTES = new Set<Route>(["overview", "passes", "new", "team", "security", "activity", "deployment"]);

function JourneyBar({ route, demoPay }: { route: Route; demoPay?: boolean }) {
  const hint =
    route === "pay" && !demoPay
      ? "This is the production till. A Playground pass cannot refund it. The demo uses 2 · Pay, which is the sandbox."
      : FLOW_HINT[route];
  return (
    <div className="flow-bar">
      <div className="flow-bar-row">
        <button className="btn flow-back" type="button" onClick={() => goBack()}>
          <ArrowLeft size={15} /> Back
        </button>
        <button className="flow-brand" type="button" onClick={() => navigate("home")}>
          <BrandMark size={22} />
          <span>OnShift</span>
        </button>
        <nav className="flow-steps" aria-label="Demo path">
          {FLOW_STEPS.map((step) => {
            const on = step.route === "overview" ? CONSOLE_ROUTES.has(route) : route === step.route;
            return (
              <button key={step.route} type="button" className={`flow-step ${on ? "on" : ""}`} onClick={() => navigate(step.route, step.params)} aria-current={on ? "page" : undefined}>
                {step.label}
              </button>
            );
          })}
        </nav>
        <ThemeToggle />
      </div>
      {hint && <p className="flow-hint">{hint}</p>}
    </div>
  );
}

export function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button className="btn theme-toggle" type="button" onClick={toggle} aria-label={dark ? "Switch to light" : "Switch to dark"}>
      {dark ? <Sun size={15} strokeWidth={2.2} /> : <Moon size={15} strokeWidth={2.2} />}
    </button>
  );
}

function AccountControl() {
  const { operators, operator, operatorRole, setOperator, connectWallet, disconnectWallet } = useSession();
  const roleBadge = operatorRole === "org" ? <Badge tone="blue">Org admin</Badge> : operatorRole === "lead" ? <Badge tone="green">Shift lead</Badge> : <Badge tone="grey">View only</Badge>;
  if (isLocal) {
    return (
      <div className="row">
        {roleBadge}
        <select className="input" style={{ width: "auto", height: 32 }} value={operator?.id} onChange={(e) => setOperator(e.target.value)} aria-label="Signed in as">
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (!operator) {
    return (
      <button className="btn btn-primary" onClick={() => connectWallet()}>
        <Wallet size={15} /> Connect Wallet
      </button>
    );
  }
  return (
    <div className="row">
      {roleBadge}
      <span className="btn mono" title={operator.signer.address}>
        {short(operator.signer.address)}
      </span>
      <button className="btn" onClick={() => connectWallet({ prompt: true })}>
        Switch
      </button>
      <button className="btn" onClick={disconnectWallet}>
        Disconnect
      </button>
    </div>
  );
}

function ConsoleLayout({ route, children }: { route: Route; children: ReactNode }) {
  const { snapshot, error } = useOnShift();
  const live = snapshot?.passes.filter((p) => p.state === "live" && !p.sandbox).length ?? 0;
  return (
    <div className="console">
      <aside className="sidebar">
        <div className="app-mark" role="link" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => navigate("home")}>
          <BrandMark size={34} withWord sub={deployment?.orgName ?? "ENSv2"} />
        </div>
        <nav className="nav">
          {CONSOLE.map((g) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-heading">{g.group}</div>
              {g.items.map((n) => (
                <button key={n.id} className={`nav-item ${route === n.id ? "active" : ""}`} onClick={() => navigate(n.id)} aria-current={route === n.id ? "page" : undefined}>
                  <n.icon size={17} strokeWidth={2} />
                  {n.label}
                  {n.id === "passes" && live > 0 && <span className="nav-count">{live}</span>}
                  {n.id === "security" && (snapshot?.incident || snapshot?.tillQuarantined) && <span className="nav-alert" aria-label="Incident active" />}
                </button>
              ))}
            </div>
          ))}
          <div className="nav-group">
            <div className="nav-heading">Open</div>
            <button className="nav-item" onClick={() => navigate("device")}>
              <Smartphone size={17} /> Staff App
            </button>
            <button className="nav-item" onClick={() => navigate("try")}>
              <FlaskConical size={17} /> Playground
            </button>
            <button className="nav-item" onClick={() => navigate("pay", { demo: "1" })}>
              <CreditCard size={17} /> Sandbox Pay
            </button>
            <button className="nav-item" onClick={() => navigate("pay")}>
              <CreditCard size={17} /> Customer Pay
            </button>
            <button className="nav-item" onClick={() => navigate("verify")}>
              <BadgeCheck size={17} /> Public Check
            </button>
          </div>
        </nav>
        <div className="sidebar-foot">
          <div className="footnote" style={{ padding: "0 10px" }}>
            <span style={{ color: error ? "var(--red)" : "var(--green)" }}>●</span> {error ? "Network unreachable" : `${networkLabel} · ENSv2`}
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="console-chrome">
          <JourneyBar route={route} />
          <div className="toolbar">
            <span className="footnote net-status">
              <span style={{ color: error ? "var(--red)" : "var(--green)" }}>●</span> {error ? "Network unreachable" : networkLabel}
            </span>
            <AccountControl />
          </div>
        </div>
        <NetworkNote />
        {children}
      </main>
    </div>
  );
}

export function App() {
  const [{ route, params }, setLocation] = useState(parseHash);
  const { snapshot, error } = useOnShift();

  useEffect(() => {
    const onHash = () => {
      if (!applyingBack) {
        const trail = readTrail();
        if (trail.length && trail[trail.length - 1] === window.location.hash) {
          trail.pop();
          writeTrail(trail);
        }
      }
      setLocation(parseHash());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const notReady = !deployment || (error && !snapshot);
  const loading = (
    <div className="empty boot-wait">
      <div className="empty-title">Reading {networkLabel}…</div>
      <p className="secondary small">Pulling ENSv2 passes and till state. If this stays blank, hard-refresh or allow scripts for this site.</p>
    </div>
  );

  if (route === "home") {
    return (
      <>
        {!deployment ? <Setup error={error} /> : <Home />}
        <Toasts />
      </>
    );
  }

  const demoPay = params.get("demo") === "1";
  const leaf = (
    <>
      <JourneyBar route={route} demoPay={demoPay} />
      {route === "verify" ? (
        notReady ? <Setup error={error} /> : <Verify initialName={params.get("name") ?? ""} />
      ) : route === "how" ? (
        <How />
      ) : route === "pay" || route === "try" ? (
        notReady ? <Setup error={error} /> : !snapshot ? loading : route === "pay" ? <PayPage demo={demoPay} /> : <TryPage />
      ) : route === "device" ? (
        notReady ? <Setup error={error} /> : !snapshot ? loading : <DeviceApp />
      ) : null}
      <Toasts />
    </>
  );
  if (route === "verify" || route === "how" || route === "pay" || route === "try" || route === "device") return leaf;

  const pages: Record<string, ReactNode> = {
    overview: <Overview />,
    passes: <Passes selected={params.get("pass")} />,
    new: <NewPass />,
    team: <Team />,
    security: <Security />,
    activity: <ActivityPage />,
    deployment: <DeploymentPage />,
  };
  return (
    <>
      <ConsoleLayout route={route}>{notReady ? <Setup error={error} /> : !snapshot ? loading : pages[route]}</ConsoleLayout>
      <Toasts />
    </>
  );
}
