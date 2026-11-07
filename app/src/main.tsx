import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OnShiftProvider } from "./lib/onshift";
import { SessionProvider } from "./lib/session";
import { bootTheme } from "./lib/theme";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { App } from "./App";
import "./styles.css";

bootTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <OnShiftProvider>
        <SessionProvider>
          <App />
        </SessionProvider>
      </OnShiftProvider>
    </ErrorBoundary>
  </StrictMode>,
);
