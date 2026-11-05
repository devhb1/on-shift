import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // viem + the ABIs make one ~650 kB chunk; fine for a single-page dapp.
  build: { chunkSizeWarningLimit: 800 },
});
