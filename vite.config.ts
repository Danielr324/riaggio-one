import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// El frontend vive en client/. Producción genera dist/client, que sirve el servidor.
export default defineConfig({
  root: "client",
  plugins: [react()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    target: "es2022",
  },
});
