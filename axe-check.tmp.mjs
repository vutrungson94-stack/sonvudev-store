import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
const axeSource = readFileSync(process.env.TEMP + "/axe.min.js", "utf8");
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const port = 9425;
const child = spawn(edge, ["--headless=new","--disable-gpu","--no-sandbox",`--remote-debugging-port=${port}`,"--user-data-dir=" + path.join(process.cwd(), ".gbuildcache", "cdp-axe2"),"about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); wsUrl = (await r.json()).webSocketDebuggerUrl; } catch { await sleep(250); } }
const socket = new WebSocket(wsUrl);
let nextId = 0; const pending = new Map(); const listeners = new Map();
socket.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } else (listeners.get(m.method)||[]).forEach(l=>l(m.params)); });
await new Promise((r) => socket.addEventListener("open", r));
const send = (method, params = {}, sessionId) => { const id = ++nextId; socket.send(JSON.stringify({ id, method, params, ...(sessionId?{sessionId}:{}) })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); };
const on = (method, fn) => { const l = listeners.get(method) || []; l.push(fn); listeners.set(method, l); };
const pages = process.argv.slice(2);
for (const url of pages) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  const loaded = new Promise((r) => on("Page.loadEventFired", r));
  await send("Page.navigate", { url }, sessionId);
  await loaded; await sleep(1200);
  const inj = await send("Runtime.evaluate", { expression: axeSource, returnByValue: true }, sessionId);
  if (inj.exceptionDetails) console.log("inject error", JSON.stringify(inj.exceptionDetails).slice(0, 300));
  const run = await send("Runtime.evaluate", { expression: `axe.run(document, { runOnly: ['link-name'] }).then(r => JSON.stringify(r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, html: (n.html||'').slice(0,260) })) }))))`, awaitPromise: true, returnByValue: true }, sessionId);
  const dom = await send("Runtime.evaluate", { expression: `JSON.stringify({ brandHtml: document.querySelector('a.brand')?.outerHTML?.slice(0,300) || null, brandText: document.querySelector('a.brand')?.textContent || null })`, returnByValue: true }, sessionId);
  console.log(`\n=== ${url} ===`);
  console.log("brand:", dom.result?.value);
  console.log("violations:", run.result?.value);
  await send("Target.closeTarget", { targetId });
}
socket.close(); child.kill(); process.exit(0);
