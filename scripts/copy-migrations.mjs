// Copies SQL migrations next to the compiled server so the production build
// can apply them at startup (tsc does not copy non-TypeScript files).
import { cpSync } from "node:fs";

cpSync("server/migrations", "dist/server/migrations", { recursive: true });
