import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  BadgeCheck,
  LayoutDashboard,
  ListChecks,
  Moon,
  PlusCircle,
  ShieldAlert,
  Smartphone,
  Sun,
  Users,
  UserRound,
  Building2,
  Bot,
  Clock3,
} from "lucide-react";
import { useOnShift } from "./lib/onshift";
import { useSession } from "./lib/session";
import { deployment } from "./lib/config";
import { Toasts } from "./components/ui";
import { Dashboard } from "./pages/Dashboard";
import { IssuePass } from "./pages/IssuePass";
import { Passes } from "./pages/Passes";
import { StaffApp } from "./pages/StaffApp";
import { Verify } from "./pages/Verify";
import { Incident } from "./pages/Incident";
import { Team } from "./pages/Team";
import { ActivityLog } from "./pages/ActivityLog";
import { Setup } from "./pages/Setup";

export type Route = "dashboard" | "issue" | "passes" | "staff" | "verify" | "incident" | "team" | "activity";

const NAV: { id: Route; label: string; icon: typeof Activity; title: string; subtitle: string }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, title: "Dashboard", subtitle: "Who holds authority for acme.eth right now" },
  { id: "issue", label: "Issue pass", icon: PlusCircle, title: "Issue a pass", subtitle: "Time-boxed, least-privilege authority as an ENS name" },
  { id: "passes", label: "Passes", icon: ListChecks, title: "Passes", subtitle: "Every pass issued, live or ended" },
  { id: "staff", label: "Staff app", icon: Smartphone, title: "Staff app", subtitle: "What a staff phone or AI agent sees" },
  { id: "verify", label: "Verify", icon: BadgeCheck, title: "Is this agent on shift?", subtitle: "Public check anyone can run - no login" },
  { id: "incident", label: "Break glass", icon: ShieldAlert, title: "Break glass", subtitle: "Stop every pass in one transaction" },
  { id: "team", label: "Team & policy", icon: Users, title: "Team & policy", subtitle: "Shift leads, budgets and role presets" },
  { id: "activity", label: "Activity", icon: Activity, title: "Activity", subtitle: "Public, on-chain audit trail" },
];

function parseHash(): { route: Route; params: URLSearchParams } {
  const [path, query] = window.location.hash.replace(/^#\/?/, "").split("?");
  const route = (NAV.find((n) => n.id === path)?.id ?? "dashboard") as Route;
  return { route, params: new URLSearchParams(query ?? "") };
}

export function navigate(route: Route, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params)}` : "";
  window.location.hash = `/${route}${q}`;
}

const IDENTITY_ICON = { org: Building2, lead: UserRound, agent: Bot, staff: Smartphone };

function IdentitySwitcher() {
  const { identities, active, setActive } = useSession();
  const Icon = IDENTITY_ICON[active.kind];
  return (
    <div className="identity" title="Every action is signed by this identity">
      <div className="avatar">
        <Icon size={17} />
      </div>
      <div>
        <div className="hint" style={{ paddingLeft: 4 }}>Acting as</div>
        <select className="select" value={active.id} onChange={(e) => setActive(e.target.value)} aria-label="Acting as">
          <optgroup label="Organisation">
            {identities.filter((i) => i.kind !== "staff").map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </optgroup>
          {identities.some((i) => i.kind === "staff") && (
            <optgroup label="Staff devices">
              {identities.filter((i) => i.kind === "staff").map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark" | null>(() => {
    try {
      return (localStorage.getItem("onshift.theme") as "light" | "dark" | null) ?? null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme;
    try {
      if (theme) localStorage.setItem("onshift.theme", theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  const isDark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return (
    <button className="icon-btn" onClick={() => setTheme(isDark ? "light" : "dark")} aria-label="Toggle theme">
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

export function App() {
  const [{ route, params }, setLocation] = useState(parseHash);
  const { snapshot, error } = useOnShift();

  useEffect(() => {
    const onHash = () => setLocation(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Demo links can open a page as a given identity, e.g. #/staff?as=agent
  const { setActive, identities } = useSession();
  const asParam = params.get("as");
  useEffect(() => {
    if (asParam && identities.some((i) => i.id === asParam)) setActive(asParam);
  }, [asParam, identities, setActive]);

  const current = NAV.find((n) => n.id === route)!;
  const liveCount = snapshot?.passes.filter((p) => p.state === "live").length ?? 0;

  let page: ReactNode;
  if (!deployment || (error && !snapshot)) page = <Setup error={error} />;
  else if (!snapshot) page = <div className="card empty">Reading the chain…</div>;
  else {
    page = {
      dashboard: <Dashboard />,
      issue: <IssuePass />,
      passes: <Passes />,
      staff: <StaffApp />,
      verify: <Verify initialName={params.get("name") ?? ""} />,
      incident: <Incident />,
      team: <Team />,
      activity: <ActivityLog />,
    }[route];
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Clock3 size={22} />
          </div>
          <div>
            <div className="brand-name">OnShift</div>
            <div className="brand-sub">{deployment?.orgName ?? "ENSv2"} · authority that expires</div>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${route === n.id ? "active" : ""}`}
              onClick={() => navigate(n.id)}
              aria-current={route === n.id ? "page" : undefined}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "passes" && liveCount > 0 && <span className="nav-badge" style={{ background: "var(--green-soft)", color: "var(--green)" }}>{liveCount}</span>}
              {n.id === "incident" && snapshot?.incident && <span className="nav-badge">ON</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          Built on ENSv2 semantics: per-pass resolvers, registry-state liveness, no renewals.
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="page-title">
            <h1>{current.title}</h1>
            <p>{current.subtitle}</p>
          </div>
          <div className="topbar-right">
            <span className={`chain-dot ${error ? "down" : ""}`}>
              <i /> {error ? "Chain offline" : `Chain ${deployment?.chainId ?? "?"} · live`}
            </span>
            <ThemeToggle />
            <IdentitySwitcher />
          </div>
        </header>
        <div className="content">{page}</div>
      </main>
      <Toasts />
    </div>
  );
}
