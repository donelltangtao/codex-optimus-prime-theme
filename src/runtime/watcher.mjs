import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const [root, rawPort, tokenArgument, readyFile] = process.argv.slice(2);
if (!path.isAbsolute(root ?? "")) throw new Error("invalid install root");
if (!/^--prime-knight-token=[a-f0-9]{32}$/.test(tokenArgument ?? "")) throw new Error("invalid watcher token");
if (!path.isAbsolute(readyFile ?? "") || readyFile !== path.join(root, ".state", "ready")) {
  throw new Error("invalid ready file");
}
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 9341 || port > 9399) throw new Error("invalid watcher port");

const injector = await import(pathToFileURL(path.join(root, "src/runtime/injector.mjs")));
const payloadModule = await import(pathToFileURL(path.join(root, "src/runtime/payload.mjs")));
const payload = await payloadModule.buildPayload({
  cssPath: path.join(root, "src/theme/prime-knight.css"),
  manifestPath: path.join(root, "config/backgrounds.json"),
  assetsRoot: root,
  projectRoot: root
});

let target;
for (let attempt = 0; attempt < 200; attempt += 1) {
  try {
    target = await injector.discoverTarget({ port });
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
if (!target) throw new Error("Codex debugger did not become ready");

const session = await new injector.CdpSession(target.target, port).open();
const stopWatching = await injector.watchPayload(session, payload);
let verification;
for (let attempt = 0; attempt < 200; attempt += 1) {
  verification = await injector.verifyPayload(session);
  if (verification.runtimePass) break;
  await new Promise((resolve) => setTimeout(resolve, 100));
}
if (!verification?.runtimePass) {
  throw new Error(`theme renderer verification failed: ${JSON.stringify(injector.cockpitVerificationSummary(verification))}`);
}
const stateDirectory = path.dirname(readyFile);
const stateInfo = await fs.lstat(stateDirectory);
if (!stateInfo.isDirectory() || stateInfo.isSymbolicLink()) throw new Error("unsafe runtime state directory");
const readyTemporaryDirectory = await fs.mkdtemp(path.join(stateDirectory, ".ready."));
try {
  const readyTemporaryFile = path.join(readyTemporaryDirectory, "ready");
  await fs.writeFile(readyTemporaryFile, "ready\n", { flag: "wx", mode: 0o600 });
  await fs.rename(readyTemporaryFile, readyFile);
} finally {
  await fs.rm(readyTemporaryDirectory, { recursive: true, force: true });
}

const keepAlive = setInterval(() => {}, 60_000);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  try { await injector.removePayload(session); } catch {}
  try { await stopWatching(); } catch {}
  session.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
await new Promise(() => {});
