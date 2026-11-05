import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import {
  FIXED_IDENTITIES,
  createStaffDevice,
  loadStaffDevices,
  removeStaffDevice,
  type Identity,
} from "./identities";
import { explain } from "./errors";
import { useOnShift } from "./onshift";

export type Toast = { id: number; tone: "success" | "error" | "info"; title: string; detail?: string };

type SessionCtx = {
  identities: Identity[];
  staffDevices: Identity[];
  active: Identity;
  setActive: (id: string) => void;
  addDevice: (name: string) => Identity;
  deleteDevice: (id: string) => void;
  toasts: Toast[];
  notify: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  /** Run a chain action with a busy flag, a toast and a data refresh. Returns true on success. */
  run: (key: string, fn: () => Promise<unknown>, success: string, successDetail?: string) => Promise<boolean>;
  busy: string | null;
};

const Session = createContext<SessionCtx | null>(null);
const ACTIVE_KEY = "onshift.active.v1";

export function SessionProvider({ children }: { children: ReactNode }) {
  const { refresh } = useOnShift();
  const [staffDevices, setStaffDevices] = useState<Identity[]>(() => loadStaffDevices());
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY) ?? "lead";
    } catch {
      return "lead";
    }
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const identities = useMemo(() => [...FIXED_IDENTITIES, ...staffDevices], [staffDevices]);
  const active = identities.find((i) => i.id === activeId) ?? FIXED_IDENTITIES[1];

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  const addDevice = useCallback((name: string) => {
    const device = createStaffDevice(name);
    setStaffDevices(loadStaffDevices());
    return device;
  }, []);

  const deleteDevice = useCallback(
    (id: string) => {
      removeStaffDevice(id);
      setStaffDevices(loadStaffDevices());
      if (activeId === id) setActive("lead");
    },
    [activeId, setActive],
  );

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, success: string, successDetail?: string) => {
      setBusy(key);
      try {
        await fn();
        notify({ tone: "success", title: success, detail: successDetail });
        await refresh();
        return true;
      } catch (e) {
        const x = explain(e);
        notify({ tone: "error", title: x.title, detail: x.detail });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [notify, refresh],
  );

  const value = useMemo(
    () => ({ identities, staffDevices, active, setActive, addDevice, deleteDevice, toasts, notify, dismiss, run, busy }),
    [identities, staffDevices, active, setActive, addDevice, deleteDevice, toasts, notify, dismiss, run, busy],
  );
  return <Session.Provider value={value}>{children}</Session.Provider>;
}

export function useSession() {
  const ctx = useContext(Session);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
