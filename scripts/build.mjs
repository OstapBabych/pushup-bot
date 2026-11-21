// Збирає worker/worker.js: вбудовує webapp/index.html у worker/worker.src.js
import { readFileSync, writeFileSync } from "fs";
const root = new URL("..", import.meta.url);
const src = readFileSync(new URL("worker/worker.src.js", root), "utf8");
const html = readFileSync(new URL("webapp/index.html", root), "utf8");
const out = "// ⚠️ ЗГЕНЕРОВАНИЙ ФАЙЛ — не редагуй вручну. Джерела: worker/worker.src.js + webapp/index.html, команда: npm run build\n" +
  src.replace("__HTML__", () => JSON.stringify(html));
writeFileSync(new URL("worker/worker.js", root), out);
console.log("✅ worker/worker.js зібрано (" + out.length + " байт)");
