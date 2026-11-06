import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Address } from "viem";
import {
  LOCAL_OPERATORS,
  createDevice,
  loadDevices,
  removeDevice,
  renameDevice,
  type Device,
  type Operator,
} from "./identities";
import { explain } from "./errors";
import { injectedWallet } from "./clients";
import { useOnShift } from "./onshift";
import { deployment, explorerTx, isLocal } from "./config";
import { sameAddress } from "./format";

export type Toast = { id: number; tone: "success" | "error" | "info"; title: string; detail?: string; href?: string };
export type OperatorRole = "org" | "lead" | "none";

type SessionCtx = {
  operators: Operator[];
  operator?: Operator;
  operatorRole: OperatorRole;
  setOperator: (id: string) => void;
  connectWallet: () => Promise<void>;
  devices: Device[];
  device?: Device;
  setDevice: (id: string) => void;
  addDevice: (name: string, kind: "staff" | "agent") => Device;
  renameDevice: (id: string, name: string) => void;
  deleteDevice: (id: string) => void;
  toasts: Toast[];
  notify: (t: Omit<Toast, "id">) => void;
  dismiss: (id: number) => void;
  /** Run a chain action with a busy flag, a toast and a refresh. Resolves true on success. */
  run: (key: string, fn: () => Promise<{ transactionHash?: string } | unknown>, success: string, detail?: string) => Promise<boolean>;
  busy: string | null;
};

const Session = createContext<SessionCtx | null>(null);
const OP_KEY = "onshift.operator.v2";
const DEV_KEY = `onshift.device.${deployment?.chainId ?? 0}.v2`;

const readLS = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const writeLS = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const { refresh, snapshot } = useOnShift();
  const [walletOperator, setWalletOperator] = useState<Operator>();
  const [operatorId, setOperatorId] = useState(() => readLS(OP_KEY) ?? (isLocal ? "lead" : "wallet"));
  const [devices, setDevices] = useState<Device[]>(() => loadDevices());
  const [deviceId, setDeviceId] = useState(() => readLS(DEV_KEY) ?? "");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const operators = useMemo(() => (walletOperator ? [...LOCAL_OPERATORS, walletOperator] : LOCAL_OPERATORS), [walletOperator]);
  const operator = operators.find((o) => o.id === operatorId) ?? (isLocal ? operators[1] : walletOperator);
  const device = devices.find((d) => d.id === deviceId);

  const operatorRole: OperatorRole = useMemo(() => {
    if (!operator || !deployment) return "none";
    if (sameAddress(operator.signer.address, deployment.org)) return "org";
    if (snapshot?.leads.some((l) => l.active && sameAddress(l.address, operator.signer.address))) return "lead";
    return "none";
  }, [operator, snapshot]);

  const setOperator = useCallback((id: string) => {
    setOperatorId(id);
    writeLS(OP_KEY, id);
  }, []);

  const setDevice = useCallback((id: string) => {
    setDeviceId(id);
    writeLS(DEV_KEY, id);
  }, []);

  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list.slice(-2), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 6500 : 4200);
    },
    [dismiss],
  );

  const connectWallet = useCallback(async () => {
    try {
      const { address } = await injectedWallet();
      setWalletOperator({ id: "wallet", label: "My wallet", signer: { kind: "injected", address: address as Address } });
      setOperator("wallet");
    } catch (e) {
      const x = explain(e);
      notify({ tone: "error", title: x.title === "No browser wallet found" ? "No wallet found" : x.title, detail: x.detail ?? "Install MetaMask or another browser wallet." });
    }
  }, [notify, setOperator]);

  const addDevice = useCallback(
    (name: string, kind: "staff" | "agent") => {
      const d = createDevice(name, kind);
      setDevices(loadDevices());
      setDevice(d.id);
      return d;
    },
    [setDevice],
  );

  const rename = useCallback((id: string, name: string) => {
    renameDevice(id, name);
    setDevices(loadDevices());
  }, []);

  const deleteDevice = useCallback(
    (id: string) => {
      removeDevice(id);
      setDevices(loadDevices());
      if (deviceId === id) setDevice("");
    },
    [deviceId, setDevice],
  );

  const run = useCallback(
    async (key: string, fn: () => Promise<unknown>, success: string, detail?: string) => {
      setBusy(key);
      try {
        const result = (await fn()) as { transactionHash?: string } | undefined;
        const href = result?.transactionHash ? explorerTx(result.transactionHash) : "";
        notify({ tone: "success", title: success, detail, href: href || undefined });
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
    () => ({
      operators,
      operator,
      operatorRole,
      setOperator,
      connectWallet,
      devices,
      device,
      setDevice,
      addDevice,
      renameDevice: rename,
      deleteDevice,
      toasts,
      notify,
      dismiss,
      run,
      busy,
    }),
    [operators, operator, operatorRole, setOperator, connectWallet, devices, device, setDevice, addDevice, rename, deleteDevice, toasts, notify, dismiss, run, busy],
  );
  return <Session.Provider value={value}>{children}</Session.Provider>;
}

export function useSession() {
  const ctx = useContext(Session);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
