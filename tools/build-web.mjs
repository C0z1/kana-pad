// Copies the static web app into dist/ for the Tauri builds (the PWA is served straight from the repo root).
import { cpSync, rmSync, mkdirSync } from "node:fs";

const FILES = ["index.html", "manifest.webmanifest", "sw.js", "css", "js", "icons", "content/kanjivg", "content/LICENSE-data.md", "LICENSE"];
rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/content", { recursive: true });
for (const f of FILES) cpSync(f, `dist/${f}`, { recursive: true });
console.log(`dist/ listo (${FILES.length} entradas)`);
