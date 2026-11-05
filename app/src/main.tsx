import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OnShiftProvider } from "./lib/onshift";
import { SessionProvider } from "./lib/session";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OnShiftProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </OnShiftProvider>
  </StrictMode>,
);
