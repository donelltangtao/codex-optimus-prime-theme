import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installDirectory = (home) => path.join(home, "Library/Application Support/Codex Prime Knight Theme");
const launcherApplication = (home) => path.join(home, "Applications/Codex 擎天柱主题.app");
const launcherShortcut = (home) => path.join(home, "Desktop/Codex 擎天柱主题.app");

const lifecycleScripts = [
  "install-macos.sh",
  "start-macos.sh",
  "verify-macos.sh",
  "restore-macos.sh"
];

test("macOS scripts never edit the Codex bundle or expose CDP", async () => {
  const source = (await Promise.all(
    lifecycleScripts.map((file) => fs.readFile(`scripts/${file}`, "utf8"))
  )).join("\n");

  assert.doesNotMatch(source, /app\.asar|codesign\s+--force|\/Applications\/Codex\.app\/Contents\//);
  assert.doesNotMatch(source, /--remote-debugging-address=(?!127\.0\.0\.1)/);
  assert.match(source, /127\.0\.0\.1/);
});

async function temporaryHome(t, prefix = "Prime Knight Home With Spaces ") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function runBash(script, args = [], options = {}) {
  try {
    const result = await execFile("/bin/bash", [script, ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...options.env },
      maxBuffer: 10 * 1024 * 1024
    });
    return { status: 0, ...result };
  } catch (error) {
    return {
      status: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? ""
    };
  }
}

async function runSourced(script, body, { env = {} } = {}) {
  return runBash("-c", [
    'script_path=$1; shift; source "$script_path"; ' + body,
    "prime-knight-test",
    path.join(projectRoot, script)
  ], { env });
}

async function writeRecordedProcess(state, prefix, { pid, start, token }) {
  await fs.writeFile(path.join(state, `${prefix}.pid`), `${pid}\n`);
  await fs.writeFile(path.join(state, `${prefix}.start`), `${start}\n`);
  await fs.writeFile(path.join(state, `${prefix}.token`), `${token}\n`);
}

test("all shell entry points have valid Bash syntax", async () => {
  const files = [
    "scripts/common-macos.sh",
    ...lifecycleScripts.map((file) => `scripts/${file}`),
    "Install Prime Knight Theme.command",
    "Start Prime Knight Theme.command",
    "Verify Prime Knight Theme.command",
    "Restore Native Codex.command"
  ];

  for (const file of files) {
    const result = await runBash("-n", [path.join(projectRoot, file)]);
    assert.equal(result.status, 0, `${file}: ${result.stderr}`);
  }
});

test("command wrappers resolve paths with spaces and delegate once to their matching script", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight Commands With Spaces "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "scripts"));
  const pairs = [
    ["Install Prime Knight Theme.command", "install-macos.sh"],
    ["Start Prime Knight Theme.command", "start-macos.sh"],
    ["Verify Prime Knight Theme.command", "verify-macos.sh"],
    ["Restore Native Codex.command", "restore-macos.sh"]
  ];

  for (const [command, script] of pairs) {
    await fs.copyFile(path.join(projectRoot, command), path.join(root, command));
    await fs.writeFile(
      path.join(root, "scripts", script),
      '#!/bin/bash\nprintf "%s\\n" "$(basename "$0")" >> "$CALL_LOG"\n',
      { mode: 0o755 }
    );
  }

  const callLog = path.join(root, "calls.log");
  for (const [command] of pairs) {
    const result = await runBash(path.join(root, command), [], {
      env: { CALL_LOG: callLog }
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual((await fs.readFile(callLog, "utf8")).trim().split("\n"), pairs.map(([, script]) => script));
});

test("command wrappers do not trust a PATH-injected dirname", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight Trusted Tools "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "scripts"));
  await fs.mkdir(path.join(root, "bin"));
  await fs.copyFile(
    path.join(projectRoot, "Install Prime Knight Theme.command"),
    path.join(root, "Install Prime Knight Theme.command")
  );
  const callLog = path.join(root, "call.log");
  const injectionLog = path.join(root, "injection.log");
  await fs.writeFile(
    path.join(root, "scripts/install-macos.sh"),
    '#!/bin/bash\nprintf "called\\n" > "$CALL_LOG"\n',
    { mode: 0o755 }
  );
  await fs.writeFile(
    path.join(root, "bin/dirname"),
    '#!/bin/bash\nprintf "injected\\n" > "$INJECTION_LOG"\nprintf "/unsafe\\n"\n',
    { mode: 0o755 }
  );

  const result = await runBash(path.join(root, "Install Prime Knight Theme.command"), [], {
    env: {
      CALL_LOG: callLog,
      INJECTION_LOG: injectionLog,
      PATH: `${path.join(root, "bin")}:${process.env.PATH}`
    }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(callLog, "utf8"), "called\n");
  await assert.rejects(fs.access(injectionLog));
});

test("common discovery accepts only the expected Codex bundle identifier", async (t) => {
  const home = await temporaryHome(t);
  const app = path.join(home, "Applications/Codex.app");
  await fs.mkdir(path.join(app, "Contents"), { recursive: true });
  const plist = (bundleId) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${bundleId}</string></dict></plist>\n`;
  await fs.writeFile(path.join(app, "Contents/Info.plist"), plist("com.openai.codex"));

  let result = await runSourced("scripts/common-macos.sh", 'pk_initialize_paths "$script_path"; pk_discover_codex_app', {
    env: { HOME: home }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /(Codex\.app|ChatGPT\.app)$/);

  await fs.writeFile(path.join(app, "Contents/Info.plist"), plist("example.impostor"));
  result = await runSourced("scripts/common-macos.sh", 'pk_initialize_paths "$script_path"; pk_discover_codex_app', {
    env: { HOME: home }
  });
  if (result.status === 0) {
    const discovered = result.stdout.trim();
    const badCandidate = await fs.realpath(app);
    assert.notEqual(discovered, badCandidate, "/Applications/Impostor.app");
  } else {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /bundle identifier/i);
  }
});

test("common discovery accepts ChatGPT app when renamed", async (t) => {
  const home = await temporaryHome(t);
  const app = path.join(home, "Applications", "ChatGPT.app");
  await fs.mkdir(path.join(app, "Contents"), { recursive: true });
  const plist = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.openai.codex</string></dict></plist>\n`;
  await fs.writeFile(path.join(app, "Contents/Info.plist"), plist);

  const result = await runSourced("scripts/common-macos.sh", 'pk_initialize_paths "$script_path"; pk_discover_codex_app', {
    env: { HOME: home }
  });
  assert.equal(result.status, 0, result.stderr);
  const discovered = result.stdout.trim();
  const preferred = await fs.realpath(app);
  assert.ok(discovered === preferred || discovered === "/Applications/ChatGPT.app", discovered);
});

const officialSigningDetails = [
  "Identifier=com.openai.codex",
  "Authority=Developer ID Application: OpenAI, L.L.C. (ABCDE12345)",
  "Authority=Developer ID Certification Authority",
  "Authority=Apple Root CA",
  "TeamIdentifier=ABCDE12345"
].join("\n");
const officialSigningDetailsWithOpCo = [
  "Identifier=com.openai.codex",
  "Authority=Developer ID Application: OpenAI OpCo, LLC (ABCDE12345)",
  "Authority=Developer ID Certification Authority",
  "Authority=Apple Root CA",
  "TeamIdentifier=ABCDE12345"
].join("\n");
const officialDesignatedRequirement = 'designated => identifier "com.openai.codex" and anchor apple generic and certificate leaf[subject.OU] = ABCDE12345';
const officialGatekeeperAssessment = [
  "/fake/Codex.app: accepted",
  "source=Notarized Developer ID",
  "origin=Developer ID Application: OpenAI, L.L.C. (ABCDE12345)"
].join("\n");

async function verifyFakeCodexSignature({ details, requirement, assessment, integrityOk = true, bypassSignature = false }) {
  const body = [
    'pk_codesign() { case "$1" in --verify) [[ "$SIGNATURE_INTEGRITY" == "ok" ]] ;; -dv) printf "%s\\n" "$SIGNING_DETAILS" >&2 ;; -d) printf "%s\\n" "$DESIGNATED_REQUIREMENT" >&2 ;; *) return 1 ;; esac; };',
    'pk_gatekeeper_assess() { printf "%s\\n" "$GATEKEEPER_ASSESSMENT" >&2; };',
    'pk_verify_codex_signature "/fake/Codex.app"'
  ].join(" ");
  const bypassEnv = bypassSignature ? "1" : "0";
  return runSourced("scripts/common-macos.sh", body, {
    env: {
      SIGNING_DETAILS: details,
      DESIGNATED_REQUIREMENT: requirement,
      GATEKEEPER_ASSESSMENT: assessment,
      SIGNATURE_INTEGRITY: integrityOk ? "ok" : "broken",
      PK_ALLOW_BROKEN_CODex_SIGNATURE: bypassEnv
    }
  });
}

test("signature verification accepts only notarized OpenAI Developer ID evidence", async () => {
  const result = await verifyFakeCodexSignature({
    details: officialSigningDetails,
    requirement: officialDesignatedRequirement,
    assessment: officialGatekeeperAssessment
  });
  assert.equal(result.status, 0, result.stderr);
  const opcoResult = await verifyFakeCodexSignature({
    details: officialSigningDetailsWithOpCo,
    requirement: officialDesignatedRequirement,
    assessment: officialGatekeeperAssessment.replace("OpenAI, L.L.C.", "OpenAI OpCo, LLC")
  });
  assert.equal(opcoResult.status, 0, opcoResult.stderr);
});

test("signature verification cannot be bypassed for a modified application", async () => {
  const result = await verifyFakeCodexSignature({
    details: [
      "Identifier=com.openai.codex",
      "Signature=(unavailable)",
      "TeamIdentifier=ABCDE12345",
      "Authority=(unavailable)",
      "Authority=Apple Root CA"
    ].join("\n"),
    requirement: officialDesignatedRequirement,
    assessment: officialGatekeeperAssessment,
    integrityOk: false,
    bypassSignature: true
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /signature verification failed/i);
});

test("theme Codex identity requires the token, isolated profile, and exact loopback port together", async (t) => {
  const home = await temporaryHome(t);
  const state = path.join(installDirectory(home), ".state");
  const record = path.join(state, "codex.record");
  const token = "abababababababababababababababab";
  await fs.mkdir(record, { recursive: true });
  await fs.writeFile(path.join(record, "pid"), "4242\n");
  await fs.writeFile(path.join(record, "start"), "theme-start\n");
  await fs.writeFile(path.join(record, "token"), `${token}\n`);
  await fs.writeFile(path.join(record, "port"), "9341\n");

  const resolvedHome = await fs.realpath(home);
  const profile = path.join(installDirectory(resolvedHome), ".profile");
  const commands = [
    `Codex --prime-knight-launch-token=${token} --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341`,
    `Codex --user-data-dir=${profile} --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341`,
    `Codex --prime-knight-launch-token=${token} --user-data-dir=${profile} --remote-debugging-port=9341`,
    `Codex --prime-knight-launch-token=${token} --user-data-dir=${profile} --remote-debugging-address=127.0.0.1 --remote-debugging-port=9342`
  ];

  for (const command of commands) {
    const result = await runSourced("scripts/common-macos.sh", [
      'pk_initialize_paths "$script_path";',
      'pk_process_alive() { :; };',
      'pk_process_uid() { /usr/bin/id -u; };',
      'pk_process_start() { printf "theme-start\\n"; };',
      'pk_process_command() { printf "%s\\n" "$PROCESS_COMMAND"; };',
      'pk_verified_theme_codex_identity 9341'
    ].join(" "), { env: { HOME: home, PROCESS_COMMAND: command } });
    assert.equal(result.status, 1, command);
  }

  const valid = await runSourced("scripts/common-macos.sh", [
    'pk_initialize_paths "$script_path";',
    'pk_process_alive() { :; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "theme-start\\n"; };',
    'pk_process_command() { printf "%s\\n" "$PROCESS_COMMAND"; };',
    'pk_verified_theme_codex_identity 9341'
  ].join(" "), {
    env: {
      HOME: home,
      PROCESS_COMMAND: `Codex --prime-knight-launch-token=${token} --user-data-dir=${profile} --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341`
    }
  });
  assert.equal(valid.status, 0, valid.stderr);
});

test("theme Codex identity rejects suffixed and conflicting duplicate launch arguments", async (t) => {
  const home = await temporaryHome(t);
  const state = path.join(installDirectory(home), ".state");
  const record = path.join(state, "codex.record");
  const token = "cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd";
  await fs.mkdir(record, { recursive: true });
  await fs.writeFile(path.join(record, "pid"), "4242\n");
  await fs.writeFile(path.join(record, "start"), "theme-start\n");
  await fs.writeFile(path.join(record, "token"), `${token}\n`);
  await fs.writeFile(path.join(record, "port"), "9341\n");

  const resolvedHome = await fs.realpath(home);
  const profile = path.join(installDirectory(resolvedHome), ".profile");
  const validArgs = `--prime-knight-launch-token=${token} --user-data-dir=${profile} --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341`;
  const commands = [
    `Codex --prime-knight-launch-token=${token}suffix --user-data-dir=${profile} --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341`,
    `Codex --prime-knight-launch-token=${token} --user-data-dir=${profile}-other --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341`,
    `Codex ${validArgs} --remote-debugging-address=0.0.0.0`,
    `Codex ${validArgs} --remote-debugging-port=9342`,
    `Codex ${validArgs} --user-data-dir=/tmp/unrelated-profile`
  ];

  for (const command of commands) {
    const result = await runSourced("scripts/common-macos.sh", [
      'pk_initialize_paths "$script_path";',
      'pk_process_alive() { :; };',
      'pk_process_uid() { /usr/bin/id -u; };',
      'pk_process_start() { printf "theme-start\\n"; };',
      'pk_process_command() { printf "%s\\n" "$PROCESS_COMMAND"; };',
      'pk_verified_theme_codex_identity 9341'
    ].join(" "), { env: { HOME: home, PROCESS_COMMAND: command } });
    assert.equal(result.status, 1, command);
  }
});

test("signature verification rejects ad-hoc, impostor, inconsistent, and unnotarized evidence", async () => {
  const invalidEvidence = [
    {
      name: "ad-hoc",
      details: "Identifier=com.openai.codex\nSignature=adhoc\nTeamIdentifier=not set",
      requirement: officialDesignatedRequirement,
      assessment: officialGatekeeperAssessment
    },
    {
      name: "OpenAI substring",
      details: officialSigningDetails.replace("OpenAI, L.L.C.", "Definitely Not OpenAI Software"),
      requirement: officialDesignatedRequirement,
      assessment: officialGatekeeperAssessment
    },
    {
      name: "different developer",
      details: officialSigningDetails.replace("OpenAI, L.L.C.", "Example Developer, Inc."),
      requirement: officialDesignatedRequirement,
      assessment: officialGatekeeperAssessment.replace("OpenAI, L.L.C.", "Example Developer, Inc.")
    },
    {
      name: "requirement Team ID mismatch",
      details: officialSigningDetails,
      requirement: officialDesignatedRequirement.replace("ABCDE12345", "ZYXWV98765"),
      assessment: officialGatekeeperAssessment
    },
    {
      name: "not notarized",
      details: officialSigningDetails,
      requirement: officialDesignatedRequirement,
      assessment: officialGatekeeperAssessment.replace("Notarized Developer ID", "Developer ID")
    }
  ];
  for (const evidence of invalidEvidence) {
    const result = await verifyFakeCodexSignature(evidence);
    assert.equal(result.status, 1, `${evidence.name}: ${result.stderr}`);
    assert.match(result.stderr, /signature|publisher|notari|Gatekeeper/i, evidence.name);
  }
});

test("port selection skips a busy port and stays inside 9341 through 9399", async () => {
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_port_in_use() { [[ "$1" == "9341" ]]; }; pk_choose_port'
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "9342");

  const boundaries = await runSourced(
    "scripts/common-macos.sh",
    'pk_valid_port 9341; pk_valid_port 9399; ! pk_valid_port 9340; ! pk_valid_port 9400'
  );
  assert.equal(boundaries.status, 0, boundaries.stderr);
});

test("entry points reject parameters and ignore install-directory environment injection", async (t) => {
  const home = await temporaryHome(t);
  const outside = path.join(home, "outside");
  for (const script of lifecycleScripts) {
    const result = await runBash(path.join(projectRoot, "scripts", script), ["--unsafe"], {
      env: {
        HOME: home,
        PRIME_KNIGHT_INSTALL_DIR: outside,
        PRIME_KNIGHT_STATE_DIR: outside
      }
    });
    assert.equal(result.status, 1, `${script}: ${result.stderr}`);
  }
  await assert.rejects(fs.access(outside));
});

test("common path initialization ignores preloaded internal path variables", async (t) => {
  const home = await temporaryHome(t);
  const outside = path.join(home, "outside");
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_initialize_paths "$script_path"; printf "%s\\n" "$PK_INSTALL_DIR"',
    {
      env: {
        HOME: home,
        PK_HOME: outside,
        PK_INSTALL_DIR: outside,
        PK_STATE_DIR: outside,
        PK_SOURCE_ROOT: outside
      }
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), path.join(await fs.realpath(home), "Library/Application Support/Codex Prime Knight Theme"));
});

test("common path initialization rejects a relative HOME", async () => {
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_initialize_paths "$script_path"',
    { env: { HOME: "relative-home" } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HOME.*absolute/i);
});

test("the isolated debugging profile persists outside ephemeral runtime state", async (t) => {
  const home = await temporaryHome(t);
  const body = [
    'pk_initialize_paths "$script_path";',
    '/bin/mkdir -p "$PK_PROFILE_DIR" "$PK_STATE_DIR";',
    'printf "keep\\n" > "$PK_PROFILE_DIR/sentinel";',
    'printf "runtime\\n" > "$PK_STATE_DIR/ready";',
    'pk_clear_runtime_state;',
    'printf "%s\\n" "$PK_PROFILE_DIR"'
  ].join(" ");
  const result = await runSourced("scripts/common-macos.sh", body, { env: { HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  const resolvedHome = await fs.realpath(home);
  const expectedProfile = path.join(installDirectory(resolvedHome), ".profile");
  assert.equal(result.stdout.trim(), expectedProfile);
  assert.equal(await fs.readFile(path.join(expectedProfile, "sentinel"), "utf8"), "keep\n");
  await assert.rejects(fs.access(path.join(installDirectory(resolvedHome), ".state")));
});

test("unsupported Node versions use exit code 2", async (t) => {
  const home = await temporaryHome(t);
  const bin = path.join(home, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "node"), '#!/bin/bash\necho "18.20.0"\n', { mode: 0o755 });
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_node_binary() { printf "%s\\n" "$FAKE_NODE"; }; pk_require_node',
    { env: { HOME: home, FAKE_NODE: path.join(bin, "node") } }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Node 20/i);
});

test("Node 20 before WebSocket support is rejected as unsupported", async (t) => {
  const home = await temporaryHome(t);
  const fakeNode = path.join(home, "node");
  const invocationLog = path.join(home, "node-invoked");
  await fs.writeFile(fakeNode, [
    "#!/bin/bash",
    'if [[ "$1" == "-p" ]]; then printf "20.9.0\\n"; exit 0; fi',
    'printf "invoked\\n" > "$INVOCATION_LOG"',
    "exit 0"
  ].join("\n"), { mode: 0o755 });
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_node_binary() { printf "%s\\n" "$FAKE_NODE"; }; pk_require_node; pk_require_cdp_capability',
    { env: { HOME: home, FAKE_NODE: fakeNode, INVOCATION_LOG: invocationLog } }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /WebSocket|Node 20\.10/i);
  await assert.rejects(fs.access(invocationLog));
});

test("the base environment gate rejects Node 20.9 before installation work", async (t) => {
  const home = await temporaryHome(t);
  const fakeNode = path.join(home, "node");
  await fs.writeFile(fakeNode, [
    "#!/bin/bash",
    'if [[ "$1" == "-p" ]]; then printf "20.9.0\\n"; exit 0; fi',
    "exit 0"
  ].join("\n"), { mode: 0o755 });
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_node_binary() { printf "%s\\n" "$FAKE_NODE"; }; pk_require_node',
    { env: { HOME: home, FAKE_NODE: fakeNode } }
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /20\.10/);
});

test("Node 20.10 and 21 propagate the WebSocket flag while Node 22 does not", async (t) => {
  for (const [version, expectedFirstArgs] of [
    ["20.10.0", ["--experimental-websocket", "--experimental-websocket"]],
    ["21.7.3", ["--experimental-websocket", "--experimental-websocket"]],
    ["22.0.0", ["-e", "--marker"]]
  ]) {
    const home = await temporaryHome(t, `Prime Knight Node ${version} `);
    const fakeNode = path.join(home, "node");
    const invocationLog = path.join(home, "node-args.log");
    await fs.writeFile(fakeNode, [
      "#!/bin/bash",
      `if [[ "$1" == "-p" ]]; then printf "${version}\\n"; exit 0; fi`,
      'printf "%s\\n" "$1" >> "$INVOCATION_LOG"',
      "exit 0"
    ].join("\n"), { mode: 0o755 });
    const result = await runSourced(
      "scripts/common-macos.sh",
      'pk_node_binary() { printf "%s\\n" "$FAKE_NODE"; }; pk_require_node; pk_require_cdp_capability; pk_run_cdp_node --marker',
      { env: { HOME: home, FAKE_NODE: fakeNode, INVOCATION_LOG: invocationLog } }
    );
    assert.equal(result.status, 0, `${version}: ${result.stderr}`);
    assert.deepEqual((await fs.readFile(invocationLog, "utf8")).trim().split("\n"), expectedFirstArgs);
  }
});

test("CDP capability failure returns 2 before Codex is opened", async (t) => {
  const home = await temporaryHome(t);
  const openMarker = path.join(home, "opened");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_verify_installation_manifest() { :; };',
    'pk_require_cdp_capability() { printf "Prime Knight: CDP unavailable\\n" >&2; return 2; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_choose_port() { printf "9341\\n"; };',
    'pk_generate_token() { printf "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\\n"; };',
    'pk_open_application() { printf "opened\\n" > "$OPEN_MARKER"; };',
    'pk_record_theme_codex() { :; };',
    'pk_start_watcher() { :; };',
    'start_main'
  ].join(" ");
  const result = await runSourced("scripts/start-macos.sh", body, {
    env: { HOME: home, OPEN_MARKER: openMarker }
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CDP unavailable/);
  await assert.rejects(fs.access(openMarker));
});

test("LaunchAgent writes a private plist for the permanent installed watcher", async (t) => {
  const home = await temporaryHome(t, "Prime Knight LaunchAgent Plist ");
  const resolvedHome = await fs.realpath(home);
  const install = installDirectory(resolvedHome);
  await fs.mkdir(path.join(install, "src/runtime"), { recursive: true });
  await fs.writeFile(path.join(install, "src/runtime/watcher.mjs"), "// fixture watcher\n");
  const token = "34343434343434343434343434343434";
  const result = await runSourced("scripts/common-macos.sh", [
    'pk_initialize_paths "$script_path";',
    'PK_NODE="$NODE_BINARY";',
    'PK_NODE_CDP_FLAG="";',
    `pk_write_launch_agent 9341 ${token}`
  ].join(" "), { env: { HOME: home, NODE_BINARY: process.execPath } });
  assert.equal(result.status, 0, result.stderr);

  const plist = path.join(resolvedHome, "Library/LaunchAgents/io.github.codex-prime-knight.theme-watcher.plist");
  const info = await fs.lstat(plist);
  assert.equal(info.isFile(), true);
  assert.equal(info.isSymbolicLink(), false);
  assert.equal(info.mode & 0o777, 0o600);
  const read = async (key) => (await execFile("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist])).stdout.trim();
  assert.equal(await read("Label"), "io.github.codex-prime-knight.theme-watcher");
  assert.equal(await read("ProgramArguments:0"), process.execPath);
  assert.equal(await read("ProgramArguments:1"), path.join(install, "src/runtime/watcher.mjs"));
  assert.equal(await read("ProgramArguments:2"), install);
  assert.equal(await read("ProgramArguments:3"), "9341");
  assert.equal(await read("ProgramArguments:4"), `--prime-knight-token=${token}`);
  assert.equal(await read("ProgramArguments:5"), path.join(install, ".state/ready"));
  assert.equal(await read("RunAtLoad"), "true");
  assert.equal(await read("KeepAlive"), "true");
});

test("LaunchAgent bootstrap uses the current GUI domain and exact service label", async (t) => {
  const home = await temporaryHome(t, "Prime Knight LaunchAgent Bootstrap ");
  const resolvedHome = await fs.realpath(home);
  const install = installDirectory(resolvedHome);
  const log = path.join(home, "launchctl.log");
  await fs.mkdir(path.join(install, "src/runtime"), { recursive: true });
  await fs.writeFile(path.join(install, "src/runtime/watcher.mjs"), "// fixture watcher\n");
  const token = "45454545454545454545454545454545";
  const result = await runSourced("scripts/common-macos.sh", [
    'pk_initialize_paths "$script_path";',
    'PK_NODE="$NODE_BINARY";',
    'PK_NODE_CDP_FLAG="";',
    `pk_write_launch_agent 9342 ${token};`,
    'pk_launchctl() { printf "%s\\0" "$@" >> "$LAUNCHCTL_LOG"; };',
    'pk_bootstrap_launch_agent'
  ].join(" "), { env: { HOME: home, NODE_BINARY: process.execPath, LAUNCHCTL_LOG: log } });
  assert.equal(result.status, 0, result.stderr);
  const uid = String(process.getuid());
  assert.deepEqual((await fs.readFile(log)).toString().split("\0").filter(Boolean), [
    "bootstrap", `gui/${uid}`, path.join(resolvedHome, "Library/LaunchAgents/io.github.codex-prime-knight.theme-watcher.plist"),
    "kickstart", "-k", `gui/${uid}/io.github.codex-prime-knight.theme-watcher`
  ]);
});

test("LaunchAgent watcher start records the exact service process only after readiness", async (t) => {
  const home = await temporaryHome(t, "Prime Knight LaunchAgent Ready ");
  const resolvedHome = await fs.realpath(home);
  const install = installDirectory(resolvedHome);
  const state = path.join(install, ".state");
  const log = path.join(home, "launchctl.log");
  await fs.mkdir(path.join(install, "src/runtime"), { recursive: true });
  await fs.writeFile(path.join(install, "src/runtime/watcher.mjs"), "// fixture watcher\n");
  const token = "56565656565656565656565656565656";
  const command = `${process.execPath} ${path.join(install, "src/runtime/watcher.mjs")} ${install} 9343 --prime-knight-token=${token} ${path.join(state, "ready")}`;
  const result = await runSourced("scripts/start-macos.sh", [
    'pk_initialize_paths "$script_path";',
    'PK_NODE="$NODE_BINARY";',
    'PK_NODE_CDP_FLAG="";',
    `pk_generate_token() { printf "${token}\\n"; };`,
    'pk_launchctl() {',
    '  printf "%s\\0" "$@" >> "$LAUNCHCTL_LOG";',
    '  if [[ "$1" == "kickstart" ]]; then printf "ready\\n" > "$PK_STATE_DIR/ready"; fi;',
    '  if [[ "$1" == "print" ]]; then printf "pid = 4242\\n"; fi;',
    '};',
    'pk_process_alive() { [[ "$1" == "4242" ]]; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "watcher-start\\n"; };',
    'pk_process_command() { printf "%s\\n" "$WATCHER_COMMAND"; };',
    'pk_start_watcher 9343'
  ].join(" "), { env: { HOME: home, NODE_BINARY: process.execPath, LAUNCHCTL_LOG: log, WATCHER_COMMAND: command } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(path.join(state, "watcher.pid"), "utf8"), "4242\n");
  assert.equal(await fs.readFile(path.join(state, "watcher.start"), "utf8"), "watcher-start\n");
  assert.equal(await fs.readFile(path.join(state, "watcher.token"), "utf8"), `${token}\n`);
});

test("permanent watcher can be restarted by LaunchAgent after a prior ready file", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight Watcher Restart "));
  const ready = path.join(root, ".state/ready");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src/runtime"), { recursive: true });
  await fs.mkdir(path.join(root, ".state"), { recursive: true });
  await fs.writeFile(ready, "stale\n");
  await fs.writeFile(path.join(root, "src/runtime/payload.mjs"), "export async function buildPayload() { return 'payload'; }\n");
  await fs.writeFile(path.join(root, "src/runtime/injector.mjs"), [
    "export async function discoverTarget() { return { target: {} }; }",
    "export class CdpSession { async open() { return this; } close() {} }",
    "export async function watchPayload() { return async () => {}; }",
    "export async function verifyPayload() { return { runtimePass: true, pass: false }; }",
    "export async function removePayload() {}"
  ].join("\n"));
  const child = spawn(process.execPath, [
    path.join(projectRoot, "src/runtime/watcher.mjs"),
    root,
    "9346",
    "--prime-knight-token=90909090909090909090909090909090",
    ready
  ], { stdio: "ignore" });
  t.after(() => { try { child.kill("SIGKILL"); } catch {} });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(child.exitCode, null);
  assert.doesNotThrow(() => process.kill(child.pid, 0));
  assert.equal(await fs.readFile(ready, "utf8"), "ready\n");
  child.kill("SIGTERM");
});

test("LaunchAgent bootstrap failure removes only the newly owned plist", async (t) => {
  const home = await temporaryHome(t, "Prime Knight LaunchAgent Rollback ");
  const resolvedHome = await fs.realpath(home);
  const install = installDirectory(resolvedHome);
  await fs.mkdir(path.join(install, "src/runtime"), { recursive: true });
  await fs.writeFile(path.join(install, "src/runtime/watcher.mjs"), "// fixture watcher\n");
  const token = "67676767676767676767676767676767";
  const result = await runSourced("scripts/start-macos.sh", [
    'pk_initialize_paths "$script_path";',
    'PK_NODE="$NODE_BINARY";',
    'PK_NODE_CDP_FLAG="";',
    `pk_generate_token() { printf "${token}\\n"; };`,
    'pk_launchctl() { [[ "$1" != "bootstrap" && "$1" != "print" ]]; };',
    'pk_start_watcher 9344'
  ].join(" "), { env: { HOME: home, NODE_BINARY: process.execPath } });
  assert.equal(result.status, 1);
  await assert.rejects(fs.access(path.join(resolvedHome, "Library/LaunchAgents/io.github.codex-prime-knight.theme-watcher.plist")));
});

test("LaunchAgent rollback preserves its plist when bootout cannot be confirmed", async (t) => {
  const home = await temporaryHome(t, "Prime Knight LaunchAgent Preserve ");
  const removed = path.join(home, "removed");
  const result = await runSourced("scripts/start-macos.sh", [
    'pk_bootout_launch_agent() { return 1; };',
    'pk_remove_owned_launch_agent() { printf "removed\\n" > "$REMOVED"; };',
    'pk_rollback_launch_agent'
  ].join(" "), { env: { HOME: home, REMOVED: removed } });
  assert.equal(result.status, 1);
  await assert.rejects(fs.access(removed));
});

test("watcher failure evidence survives clean runtime-state rollback", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight Failure Evidence "));
  const state = path.join(root, ".state");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(state, "watcher.log"), "renderer verification failed\n");
  const result = await runSourced("scripts/start-macos.sh", [
    'PK_INSTALL_DIR="$FIXTURE_ROOT";',
    'PK_STATE_DIR="$FIXTURE_STATE";',
    'pk_preserve_watcher_failure_log;',
    '/bin/rm -rf "$PK_STATE_DIR"'
  ].join(" "), { env: { FIXTURE_ROOT: root, FIXTURE_STATE: state } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(path.join(root, "last-start-error.log"), "utf8"), "renderer verification failed\n");
});

test("LaunchAgent verification fails closed when the recorded service is not loaded", async (t) => {
  const home = await temporaryHome(t, "Prime Knight LaunchAgent Verify ");
  const resolvedHome = await fs.realpath(home);
  const install = installDirectory(resolvedHome);
  const state = path.join(install, ".state");
  await fs.mkdir(path.join(install, "src/runtime"), { recursive: true });
  await fs.writeFile(path.join(install, "src/runtime/watcher.mjs"), "// fixture watcher\n");
  await fs.mkdir(state, { recursive: true });
  await writeRecordedProcess(state, "watcher", { pid: 4242, start: "watcher-start", token: "78787878787878787878787878787878" });
  const result = await runSourced("scripts/common-macos.sh", [
    'pk_initialize_paths "$script_path";',
    'PK_NODE="$NODE_BINARY";',
    'PK_NODE_CDP_FLAG="";',
    'pk_write_launch_agent 9345 78787878787878787878787878787878;',
    'pk_launchctl() { return 1; };',
    'pk_process_alive() { :; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "watcher-start\\n"; };',
    'pk_process_command() { printf "node watcher --prime-knight-token=78787878787878787878787878787878\\n"; };',
    'pk_verified_theme_pid'
  ].join(" "), { env: { HOME: home, NODE_BINARY: process.execPath } });
  assert.notEqual(result.status, 0, result.stdout);
});

test("LaunchAgent removal refuses symlinked or foreign plist files", async (t) => {
  const home = await temporaryHome(t, "Prime Knight LaunchAgent Ownership ");
  const agents = path.join(home, "Library/LaunchAgents");
  const plist = path.join(agents, "io.github.codex-prime-knight.theme-watcher.plist");
  const outside = path.join(home, "outside.plist");
  await fs.mkdir(agents, { recursive: true });
  await fs.writeFile(outside, "do not remove\n");
  await fs.symlink(outside, plist);

  let result = await runSourced("scripts/common-macos.sh", 'pk_initialize_paths "$script_path"; pk_remove_owned_launch_agent', {
    env: { HOME: home }
  });
  assert.equal(result.status, 1);
  assert.equal(await fs.readFile(outside, "utf8"), "do not remove\n");
  assert.equal((await fs.lstat(plist)).isSymbolicLink(), true);

  await fs.unlink(plist);
  await fs.writeFile(plist, `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>foreign.agent</string><key>ProgramArguments</key><array><string>/foreign</string></array></dict></plist>`);
  result = await runSourced("scripts/common-macos.sh", 'pk_initialize_paths "$script_path"; pk_remove_owned_launch_agent', {
    env: { HOME: home }
  });
  assert.equal(result.status, 1);
  await fs.access(plist);
});

test("restore preserves runtime state when LaunchAgent bootout cannot be confirmed", async (t) => {
  const home = await temporaryHome(t, "Prime Knight LaunchAgent Restore ");
  const resolvedHome = await fs.realpath(home);
  const install = installDirectory(resolvedHome);
  const state = path.join(install, ".state");
  const actions = path.join(home, "actions.log");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(state, "watcher.token"), "89898989898989898989898989898989\n");
  const result = await runSourced("scripts/restore-macos.sh", [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_require_installation() { :; };',
    'pk_runtime_record_present() { :; };',
    'pk_recorded_theme_port() { return 1; };',
    'pk_pending_launch_present() { return 1; };',
    'pk_watcher_record_present() { :; };',
    'pk_launch_agent_plist_present() { :; };',
    'pk_bootout_launch_agent() { printf "bootout\\n" >> "$ACTIONS"; return 1; };',
    'pk_remove_owned_launch_agent() { printf "remove-plist\\n" >> "$ACTIONS"; };',
    'pk_stop_verified_watcher() { printf "legacy-stop\\n" >> "$ACTIONS"; };',
    'pk_theme_codex_record_present() { return 1; };',
    'pk_open_codex_native() { printf "open-native\\n" >> "$ACTIONS"; };',
    'restore_main'
  ].join(" "), { env: { HOME: home, ACTIONS: actions } });
  assert.equal(result.status, 1);
  assert.deepEqual((await fs.readFile(actions, "utf8")).trim().split("\n"), ["bootout", "open-native"]);
  await fs.access(path.join(state, "watcher.token"));
});

test("package verification requires the declared Node 20.10 runtime floor", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight Package "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "codex-prime-knight-theme",
    version: "0.1.0-local",
    engines: { node: ">=20" }
  }));
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_require_node; pk_verify_package_metadata "$PACKAGE_ROOT"',
    { env: { PACKAGE_ROOT: root } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package.*version|engine/i);
});

test("owned-file validation rejects an intermediate symlink", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight Owned Root "));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "Prime Knight Outside "));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "file.txt"), "outside");
  await fs.symlink(outside, path.join(root, "nested"));
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_owned_relative_paths() { printf "nested/file.txt\\n"; }; pk_validate_owned_files "$OWNED_ROOT"',
    { env: { OWNED_ROOT: root } }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /symlink/i);
});

test("install is idempotent, quotes spaced paths, and preserves unrelated files", async (t) => {
  const home = await temporaryHome(t);
  const env = { HOME: home };
  const body = [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'install_main'
  ].join(" ");

  let result = await runSourced("scripts/install-macos.sh", body, { env });
  assert.equal(result.status, 0, result.stderr);
  const install = installDirectory(home);
  const manifest = path.join(install, ".install-manifest.sha256");
  const firstManifest = await fs.readFile(manifest, "utf8");
  const packagePath = path.join(install, "package.json");
  const firstStat = await fs.stat(packagePath);
  const unrelated = path.join(install, "notes from user.txt");
  await fs.writeFile(unrelated, "keep me");

  result = await runSourced("scripts/install-macos.sh", body, { env });
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /desktop shortcut already exists and was preserved/i);
  assert.equal(await fs.readFile(manifest, "utf8"), firstManifest);
  assert.equal((await fs.stat(packagePath)).mtimeMs, firstStat.mtimeMs);
  assert.equal(await fs.readFile(unrelated, "utf8"), "keep me");
  assert.match(firstManifest, /assets\/backgrounds\/00\.webp/);
  assert.match(firstManifest, /assets\/backgrounds\/23\.webp/);
  assert.match(firstManifest, /src\/runtime\/injector\.mjs/);
  assert.doesNotMatch(firstManifest, /\.codex\/pets/);
});

test("install places the launcher in user Applications, creates a desktop shortcut, and starts the installed theme entry", async (t) => {
  const home = await temporaryHome(t, "Prime Knight Launcher Install ");
  const resolvedHome = await fs.realpath(home);
  const startMarker = path.join(home, "started-theme.txt");
  const forbiddenOpenMarker = path.join(home, "opened-launcher.txt");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_start_installed_theme() { printf "%s\\n" "$PK_INSTALL_DIR/Start Prime Knight Theme.command" > "$START_MARKER"; };',
    'pk_open_application() { printf "%s\\n" "$1" > "$FORBIDDEN_OPEN_MARKER"; return 1; };',
    'install_and_launch_main'
  ].join(" ");

  const result = await runSourced("scripts/install-macos.sh", body, {
    env: { HOME: home, START_MARKER: startMarker, FORBIDDEN_OPEN_MARKER: forbiddenOpenMarker }
  });

  assert.equal(result.status, 0, result.stderr);
  const application = launcherApplication(resolvedHome);
  const executable = path.join(application, "Contents/MacOS/Codex擎天柱主题");
  assert.notEqual((await fs.stat(executable)).mode & 0o111, 0);
  assert.equal((await fs.lstat(launcherShortcut(resolvedHome))).isSymbolicLink(), true);
  assert.equal(await fs.readlink(launcherShortcut(resolvedHome)), application);
  assert.equal(
    (await fs.readFile(startMarker, "utf8")).trim(),
    path.join(installDirectory(resolvedHome), "Start Prime Knight Theme.command")
  );
  await assert.rejects(fs.access(forbiddenOpenMarker));
  const owner = (await execFile("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :PrimeKnightOwner",
    path.join(application, "Contents/Info.plist")
  ])).stdout.trim();
  assert.equal(owner, "codex-prime-knight-theme:v1");
});

test("install never overwrites an unrelated app at the launcher destination", async (t) => {
  const home = await temporaryHome(t, "Prime Knight Foreign Launcher ");
  const application = launcherApplication(home);
  const marker = path.join(application, "do-not-replace.txt");
  await fs.mkdir(path.join(application, "Contents/MacOS"), { recursive: true });
  await fs.writeFile(path.join(application, "Contents/Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.github.donelltangtao.codex-prime-knight-launcher</string>
<key>CFBundleExecutable</key><string>Codex擎天柱主题</string>
</dict></plist>\n`);
  await fs.writeFile(path.join(application, "Contents/MacOS/Codex擎天柱主题"), "#!/bin/bash\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(marker, "unrelated app\n");

  const result = await runSourced("scripts/install-macos.sh", [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'install_main'
  ].join(" "), { env: { HOME: home } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /launcher|application|ownership/i);
  assert.equal(await fs.readFile(marker, "utf8"), "unrelated app\n");
});

test("install refuses an existing directory without its ownership marker", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  await fs.mkdir(install, { recursive: true });
  const unrelated = path.join(install, "unrelated.txt");
  await fs.writeFile(unrelated, "untouched");
  const result = await runSourced("scripts/install-macos.sh", 'pk_require_supported_environment() { :; }; install_main', {
    env: { HOME: home }
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /ownership/i);
  assert.equal(await fs.readFile(unrelated, "utf8"), "untouched");
  await assert.rejects(fs.access(path.join(install, ".prime-knight-owner")));
});

test("install refuses to replace an owned path redirected through a symlink", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  await fs.mkdir(path.join(install, "src"), { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  const outside = path.join(home, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "sentinel"), "untouched");
  await fs.symlink(outside, path.join(install, "src", "runtime"));

  const result = await runSourced("scripts/install-macos.sh", 'pk_require_supported_environment() { :; }; install_main', {
    env: { HOME: home }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /symlink/i);
  assert.equal(await fs.readFile(path.join(outside, "sentinel"), "utf8"), "untouched");
  await assert.rejects(fs.access(path.join(outside, "injector.mjs")));
});

test("theme launch arguments bind CDP to loopback on a selected safe port", async () => {
  const token = "abcdef0123456789abcdef0123456789";
  const profile = "/tmp/Prime Knight Theme Profile";
  const result = await runSourced(
    "scripts/start-macos.sh",
    `pk_open_application() { printf "%s\\\\0" "$@"; }; pk_launch_codex_theme "/Applications With Spaces/Codex.app" 9377 ${token} "${profile}"`
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.split("\0").filter(Boolean), [
    "-na",
    "/Applications With Spaces/Codex.app",
    "--args",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=9377",
    `--prime-knight-launch-token=${token}`,
    `--user-data-dir=${profile}`
  ]);
});

test("the permanent watcher entry is part of the installed owned-file boundary", async () => {
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_owned_relative_paths | /usr/bin/grep -Fx "src/runtime/watcher.mjs"'
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "src/runtime/watcher.mjs");
});

test("the installed payload boundary includes the cockpit geometry module", async () => {
  const result = await runSourced(
    "scripts/common-macos.sh",
    'pk_owned_relative_paths | /usr/bin/grep -Fx "src/theme/cockpit-layout.mjs"'
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "src/theme/cockpit-layout.mjs");
});

test("every watcher initialization failure rolls back the precisely recorded debug Codex", async (t) => {
  for (const failurePoint of ["token", "mktemp", "nohup", "starttime"]) {
    const home = await temporaryHome(t, `Prime Knight ${failurePoint} rollback `);
    const stopped = path.join(home, "codex-stopped");
    const token = "56565656565656565656565656565656";
    const body = [
      'pk_require_supported_environment() { pk_validate_home; };',
      'pk_verify_installation_manifest() { :; };',
      'pk_require_cdp_capability() { :; };',
      'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
      'pk_verify_codex_signature() { :; };',
      'pk_choose_port() { printf "9342\\n"; };',
      `pk_generate_token() { printf "${token}\\n"; };`,
      'pk_launch_codex_theme() { :; };',
      'pk_candidate_pids() { printf "4242\\n"; };',
      'pk_process_uid() { /usr/bin/id -u; };',
      'pk_process_start() { printf "theme-start\\n"; };',
      `pk_process_command() { printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9342 --prime-knight-launch-token=${token} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
      'pk_process_alive() { [[ ! -f "$STOPPED" ]]; };',
      'pk_signal_process() { [[ "$1" == "TERM" && "$2" == "4242" ]] || return 1; printf "stopped\\n" > "$STOPPED"; };',
      `pk_start_watcher() { printf "${failurePoint} failed\\n" >&2; return 1; };`,
      'start_main'
    ].join(" ");
    const result = await runSourced("scripts/start-macos.sh", body, { env: { HOME: home, STOPPED: stopped } });
    assert.equal(result.status, 1, `${failurePoint}: ${result.stderr}`);
    assert.equal(await fs.readFile(stopped, "utf8"), "stopped\n", failurePoint);
    await assert.rejects(fs.access(path.join(installDirectory(home), ".state")), failurePoint);
  }
});

test("a post-launch record timeout stops the exact pending debug Codex and clears pending state", async (t) => {
  const home = await temporaryHome(t);
  const stopped = path.join(home, "codex-stopped");
  const token = "91919191919191919191919191919191";
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_verify_installation_manifest() { :; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_choose_port() { printf "9342\\n"; };',
    `pk_generate_token() { printf "${token}\\n"; };`,
    'pk_launch_codex_theme() { :; };',
    'pk_record_theme_codex() { return 1; };',
    'pk_candidate_pids() { printf "4242\\n"; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "theme-start\\n"; };',
    `pk_process_command() { printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9342 --prime-knight-launch-token=${token} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
    'pk_process_alive() { [[ ! -f "$STOPPED" ]]; };',
    'pk_signal_process() { [[ "$1" == "TERM" && "$2" == "4242" ]] || return 1; printf "stopped\\n" > "$STOPPED"; };',
    'start_main'
  ].join(" ");
  const result = await runSourced("scripts/start-macos.sh", body, { env: { HOME: home, STOPPED: stopped } });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(await fs.readFile(stopped, "utf8"), "stopped\n");
  await assert.rejects(fs.access(path.join(installDirectory(home), ".state")));
});

test("a post-launch record failure preserves pending identity when exact shutdown cannot be confirmed", async (t) => {
  const home = await temporaryHome(t);
  const token = "92929292929292929292929292929292";
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_verify_installation_manifest() { :; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_choose_port() { printf "9343\\n"; };',
    `pk_generate_token() { printf "${token}\\n"; };`,
    'pk_launch_codex_theme() { :; };',
    'pk_record_theme_codex() { return 1; };',
    'pk_candidate_pids() { printf "4242\\n"; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "theme-start\\n"; };',
    `pk_process_command() { printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9343 --prime-knight-launch-token=${token} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
    'pk_process_alive() { :; };',
    'pk_signal_process() { return 1; };',
    'start_main'
  ].join(" ");
  const result = await runSourced("scripts/start-macos.sh", body, { env: { HOME: home } });
  assert.equal(result.status, 1, result.stderr);
  const pending = path.join(installDirectory(home), ".state", "launch.pending");
  assert.equal((await fs.readFile(path.join(pending, "token"), "utf8")).trim(), token);
  assert.equal((await fs.readFile(path.join(pending, "port"), "utf8")).trim(), "9343");
});

test("a delayed post-launch process keeps pending identity for a later restore", async (t) => {
  const home = await temporaryHome(t);
  const token = "93939393939393939393939393939393";
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_verify_installation_manifest() { :; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_choose_port() { printf "9344\\n"; };',
    `pk_generate_token() { printf "${token}\\n"; };`,
    'pk_launch_codex_theme() { :; };',
    'pk_record_theme_codex() { return 1; };',
    'pk_candidate_pids() { :; };',
    'start_main'
  ].join(" ");
  const result = await runSourced("scripts/start-macos.sh", body, { env: { HOME: home } });
  assert.equal(result.status, 1, result.stderr);
  const pending = path.join(installDirectory(home), ".state", "launch.pending");
  assert.equal((await fs.readFile(path.join(pending, "token"), "utf8")).trim(), token);
  assert.equal((await fs.readFile(path.join(pending, "port"), "utf8")).trim(), "9344");
});

test("start refuses to erase a recoverable pending launch from an earlier failure", async (t) => {
  const home = await temporaryHome(t);
  const state = path.join(installDirectory(home), ".state");
  const pending = path.join(state, "launch.pending");
  await fs.mkdir(pending, { recursive: true });
  await fs.writeFile(path.join(pending, "token"), "95959595959595959595959595959595\n");
  await fs.writeFile(path.join(pending, "port"), "9346\n");
  const openMarker = path.join(home, "opened");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_verify_installation_manifest() { :; };',
    'pk_require_cdp_capability() { :; };',
    'pk_open_application() { printf "opened\\n" > "$OPEN_MARKER"; };',
    'start_main'
  ].join(" ");
  const result = await runSourced("scripts/start-macos.sh", body, { env: { HOME: home, OPEN_MARKER: openMarker } });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /restore|runtime state/i);
  await fs.access(path.join(pending, "token"));
  await assert.rejects(fs.access(openMarker));
});

test("start refuses an orphan watcher whose theme Codex identity is ambiguous", async (t) => {
  const home = await temporaryHome(t);
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_verify_installation_manifest() { :; };',
    'pk_require_cdp_capability() { :; };',
    'pk_verified_theme_pid() { printf "3131\\n"; };',
    'pk_recorded_theme_port() { printf "9341\\n"; };',
    'pk_verified_theme_codex_identity() { return 1; };',
    'start_main'
  ].join(" ");
  const result = await runSourced("scripts/start-macos.sh", body, { env: { HOME: home } });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /restore|identity/i);
  assert.doesNotMatch(result.stdout, /already running/i);
});

test("start safely recovers a dead theme Codex and launches its replacement", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  const actions = path.join(home, "actions.log");
  const launchAgentRemoved = path.join(home, "launch-agent-removed");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(state, "watcher.pid"), "3131\n");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_verify_installation_manifest() { :; };',
    'pk_require_cdp_capability() { :; };',
    'pk_verified_theme_pid() { printf "3131\\n"; };',
    'pk_recorded_theme_port() { printf "9341\\n"; };',
    'pk_verified_theme_codex_identity() { return 3; };',
    'pk_launch_agent_plist_present() { [[ ! -e "$LAUNCH_AGENT_REMOVED" ]]; };',
    'pk_bootout_launch_agent() { printf "bootout\\n" >> "$ACTIONS"; };',
    'pk_remove_owned_launch_agent() { printf "remove-plist\\n" >> "$ACTIONS"; : > "$LAUNCH_AGENT_REMOVED"; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_choose_port() { printf "9342\\n"; };',
    'pk_generate_token() { printf "abababababababababababababababab\\n"; };',
    'pk_launch_codex_theme() { printf "launch\\n" >> "$ACTIONS"; };',
    'pk_record_theme_codex() { printf "record\\n" >> "$ACTIONS"; /bin/rm -rf "$PK_STATE_DIR/launch.pending"; };',
    'pk_start_watcher() { printf "watcher\\n" >> "$ACTIONS"; };',
    'start_main'
  ].join(" ");

  const result = await runSourced("scripts/start-macos.sh", body, {
    env: { HOME: home, ACTIONS: actions, LAUNCH_AGENT_REMOVED: launchAgentRemoved }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await fs.readFile(actions, "utf8")).trim().split("\n"), [
    "bootout",
    "remove-plist",
    "launch",
    "record",
    "watcher"
  ]);
  assert.match(result.stdout, /started/i);
});

async function watcherStopFixture(t, body) {
  const home = await temporaryHome(t);
  const state = path.join(installDirectory(home), ".state");
  await fs.mkdir(state, { recursive: true });
  await writeRecordedProcess(state, "watcher", {
    pid: 3131,
    start: "watcher-start",
    token: "78787878787878787878787878787878"
  });
  return {
    home,
    state,
    result: await runSourced("scripts/common-macos.sh", `pk_initialize_paths "$script_path"; ${body} pk_stop_verified_watcher`, {
      env: { HOME: home }
    })
  };
}

const verifiedWatcherDoubles = [
  'pk_process_uid() { /usr/bin/id -u; };',
  'pk_process_start() { printf "watcher-start\\n"; };',
  'pk_process_command() { printf "node watcher --prime-knight-token=78787878787878787878787878787878\\n"; };'
].join(" ");

test("watcher stop propagates a TERM failure while the verified process remains alive", async (t) => {
  const { result, state } = await watcherStopFixture(t, [
    verifiedWatcherDoubles,
    'pk_process_alive() { :; };',
    'pk_signal_process() { [[ "$1" != "TERM" ]]; };'
  ].join(" "));
  assert.equal(result.status, 1, result.stderr);
  await fs.access(path.join(state, "watcher.pid"));
});

test("watcher stop propagates a KILL failure after TERM times out", async (t) => {
  const { result } = await watcherStopFixture(t, [
    verifiedWatcherDoubles,
    'pk_process_alive() { :; };',
    'pk_signal_process() { [[ "$1" == "TERM" ]]; };'
  ].join(" "));
  assert.equal(result.status, 1, result.stderr);
});

test("watcher stop returns failure when the verified process survives TERM and KILL", async (t) => {
  const { result } = await watcherStopFixture(t, [
    verifiedWatcherDoubles,
    'pk_process_alive() { :; };',
    'pk_signal_process() { :; };'
  ].join(" "));
  assert.equal(result.status, 1, result.stderr);
});

test("watcher stop never KILLs a PID that is reused after TERM", async (t) => {
  const { result, home } = await watcherStopFixture(t, [
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { [[ -f "$PK_HOME/signals.log" ]] && printf "reused-start\\n" || printf "watcher-start\\n"; };',
    'pk_process_command() { [[ -f "$PK_HOME/signals.log" ]] && printf "unrelated\\n" || printf "node watcher --prime-knight-token=78787878787878787878787878787878\\n"; };',
    'pk_process_alive() { :; };',
    'pk_signal_process() { printf "%s:%s\\n" "$1" "$2" >> "$PK_HOME/signals.log"; };'
  ].join(" "));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(path.join(home, "signals.log"), "utf8"), "TERM:3131\n");
});

test("watcher stop succeeds after TERM confirms the verified process exited", async (t) => {
  const { result, home } = await watcherStopFixture(t, [
    verifiedWatcherDoubles,
    'pk_process_alive() { [[ ! -f "$PK_HOME/stopped" ]]; };',
    'pk_signal_process() { [[ "$1" == "TERM" ]]; printf "stopped\\n" > "$PK_HOME/stopped"; };'
  ].join(" "));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(path.join(home, "stopped"), "utf8"), "stopped\n");
});

test("restore removes DOM despite a stale watcher and stops only the recorded theme Codex", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  const pet = path.join(home, ".codex/pets/prime-knight/sentinel");
  await fs.mkdir(path.dirname(pet), { recursive: true });
  await fs.writeFile(pet, "keep pet");
  const watcher = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "actual-token"], { stdio: "ignore" });
  t.after(() => { try { watcher.kill("SIGKILL"); } catch {} });
  await new Promise((resolve) => watcher.once("spawn", resolve));
  await writeRecordedProcess(state, "watcher", { pid: watcher.pid, start: "stale", token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  const codexToken = "11111111111111111111111111111111";
  await writeRecordedProcess(state, "codex", {
    pid: 4242,
    start: "Mon Aug 18 10:00:00 2026",
    token: codexToken
  });
  await fs.writeFile(path.join(state, "port"), "9341\n");
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    `pk_process_alive() { [[ "$1" == "4242" && ! -f "$PK_HOME/codex-stopped" ]] || [[ "$1" == "${watcher.pid}" ]]; };`,
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { [[ "$1" == "4242" ]] && printf "Mon Aug 18 10:00:00 2026\\n"; };',
    `pk_process_command() { [[ "$1" == "4242" ]] && printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341 --prime-knight-launch-token=${codexToken} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
    'pk_signal_process() { [[ "$2" == "4242" ]] || return 1; printf "stopped\\n" > "$PK_HOME/codex-stopped"; printf "signal:%s\\n" "$2" >> "$ACTION_LOG"; };',
    'pk_send_remove_payload() { printf "remove\\n" >> "$ACTION_LOG"; };',
    'pk_open_codex_native() { printf "open:%s\\n" "$1" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  const result = await runSourced("scripts/restore-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(pet, "utf8"), "keep pet");
  assert.equal(watcher.exitCode, null);
  process.kill(watcher.pid, 0);
  assert.deepEqual((await fs.readFile(actionLog, "utf8")).trim().split("\n"), [
    "remove",
    "signal:4242",
    "open:/fake/Codex.app"
  ]);
  await assert.rejects(fs.access(state));
});

test("restore reports watcher stop failure and preserves identity state", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  const watcherToken = "89898989898989898989898989898989";
  const codexToken = "90909090909090909090909090909090";
  await writeRecordedProcess(state, "watcher", { pid: 3131, start: "watcher-start", token: watcherToken });
  await writeRecordedProcess(state, "codex", { pid: 4242, start: "codex-start", token: codexToken });
  await fs.writeFile(path.join(state, "port"), "9344\n");
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { [[ "$1" == "3131" ]] && printf "watcher-start\\n" || printf "codex-start\\n"; };',
    `pk_process_command() { [[ "$1" == "3131" ]] && printf "node --prime-knight-token=${watcherToken}\\n" || printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9344 --prime-knight-launch-token=${codexToken} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
    'pk_process_alive() { [[ "$1" == "3131" ]] || [[ "$1" == "4242" && ! -f "$PK_HOME/codex-stopped" ]]; };',
    'pk_signal_process() { printf "%s:%s\\n" "$1" "$2" >> "$ACTION_LOG"; if [[ "$2" == "3131" ]]; then return 1; fi; printf "stopped\\n" > "$PK_HOME/codex-stopped"; };',
    'pk_send_remove_payload() { printf "remove\\n" >> "$ACTION_LOG"; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  const result = await runSourced("scripts/restore-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual((await fs.readFile(actionLog, "utf8")).trim().split("\n"), ["remove", "TERM:3131", "TERM:4242", "open"]);
  await fs.access(path.join(state, "watcher.pid"));
  await fs.access(path.join(state, "codex.pid"));
});

test("restore returns 1 after remove failure but still stops theme Codex and opens native", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  const token = "22222222222222222222222222222222";
  await writeRecordedProcess(state, "codex", { pid: 4242, start: "theme-start", token });
  await fs.writeFile(path.join(state, "port"), "9341\n");
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "theme-start\\n"; };',
    `pk_process_command() { printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341 --prime-knight-launch-token=${token} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
    'pk_process_alive() { [[ ! -f "$PK_HOME/codex-stopped" ]]; };',
    'pk_signal_process() { printf "stopped\\n" > "$PK_HOME/codex-stopped"; printf "signal\\n" >> "$ACTION_LOG"; };',
    'pk_send_remove_payload() { printf "remove-failed\\n" >> "$ACTION_LOG"; return 1; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  const result = await runSourced("scripts/restore-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 1);
  assert.deepEqual((await fs.readFile(actionLog, "utf8")).trim().split("\n"), ["remove-failed", "signal", "open"]);
  await assert.rejects(fs.access(state));
});

test("restore still stops theme Codex and opens native when CDP capability is unavailable", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  const token = "23232323232323232323232323232323";
  await writeRecordedProcess(state, "codex", { pid: 4242, start: "theme-start", token });
  await fs.writeFile(path.join(state, "port"), "9341\n");
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_require_cdp_capability() { printf "capability-failed\\n" >> "$ACTION_LOG"; return 2; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "theme-start\\n"; };',
    `pk_process_command() { printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341 --prime-knight-launch-token=${token} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
    'pk_process_alive() { [[ ! -f "$PK_HOME/codex-stopped" ]]; };',
    'pk_signal_process() { printf "stopped\\n" > "$PK_HOME/codex-stopped"; printf "signal\\n" >> "$ACTION_LOG"; };',
    'pk_send_remove_payload() { printf "unexpected-remove\\n" >> "$ACTION_LOG"; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  const result = await runSourced("scripts/restore-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 1);
  assert.deepEqual((await fs.readFile(actionLog, "utf8")).trim().split("\n"), ["capability-failed", "signal", "open"]);
  await assert.rejects(fs.access(state));
});

test("restore recovers a safe port from complete Codex identity when the port file is missing", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  const token = "67676767676767676767676767676767";
  await writeRecordedProcess(state, "codex", { pid: 4242, start: "theme-start", token });
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_require_cdp_capability() { printf "capability-failed\\n" >> "$ACTION_LOG"; return 2; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "theme-start\\n"; };',
    `pk_process_command() { printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9347 --prime-knight-launch-token=${token} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
    'pk_process_alive() { [[ ! -f "$PK_HOME/codex-stopped" ]]; };',
    'pk_signal_process() { printf "stopped\\n" > "$PK_HOME/codex-stopped"; printf "signal:%s\\n" "$2" >> "$ACTION_LOG"; };',
    'pk_send_remove_payload() { printf "unexpected-remove\\n" >> "$ACTION_LOG"; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  const result = await runSourced("scripts/restore-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 1);
  assert.deepEqual((await fs.readFile(actionLog, "utf8")).trim().split("\n"), ["capability-failed", "signal:4242", "open"]);
  await assert.rejects(fs.access(state));
});

test("restore refuses a reused theme PID and does not signal a coexisting native Codex", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  const token = "33333333333333333333333333333333";
  await writeRecordedProcess(state, "codex", { pid: 4242, start: "old-start", token });
  await fs.writeFile(path.join(state, "port"), "9341\n");
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_process_alive() { [[ "$1" == "4242" || "$1" == "5252" ]]; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { [[ "$1" == "4242" ]] && printf "reused-start\\n" || printf "native-start\\n"; };',
    `pk_process_command() { [[ "$1" == "4242" ]] && printf "unrelated --prime-knight-launch-token=${token}\\n" || printf "Codex native\\n"; };`,
    'pk_signal_process() { printf "signal:%s\\n" "$2" >> "$ACTION_LOG"; };',
    'pk_send_remove_payload() { printf "remove\\n" >> "$ACTION_LOG"; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  const result = await runSourced("scripts/restore-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 1);
  assert.deepEqual((await fs.readFile(actionLog, "utf8")).trim().split("\n"), ["open"]);
  await fs.access(state);
});

test("restore recovers and stops a delayed process from pending launch identity without CDP access", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  const pending = path.join(state, "launch.pending");
  const token = "94949494949494949494949494949494";
  await fs.mkdir(pending, { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  await fs.writeFile(path.join(pending, "token"), `${token}\n`);
  await fs.writeFile(path.join(pending, "port"), "9345\n");
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_candidate_pids() { printf "4242\\n"; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { printf "delayed-start\\n"; };',
    `pk_process_command() { printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9345 --prime-knight-launch-token=${token} --user-data-dir=$PK_PROFILE_DIR\\n"; };`,
    'pk_process_alive() { [[ ! -f "$PK_HOME/codex-stopped" ]]; };',
    'pk_signal_process() { printf "stopped\\n" > "$PK_HOME/codex-stopped"; printf "signal:%s\\n" "$2" >> "$ACTION_LOG"; };',
    'pk_send_remove_payload() { printf "unexpected-remove\\n" >> "$ACTION_LOG"; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  const result = await runSourced("scripts/restore-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await fs.readFile(actionLog, "utf8")).trim().split("\n"), ["signal:4242", "open"]);
  await assert.rejects(fs.access(state));
});

test("restore signals the recorded theme Codex without touching a coexisting native Codex", async (t) => {
  const home = await temporaryHome(t);
  const install = installDirectory(home);
  const state = path.join(install, ".state");
  await fs.mkdir(state, { recursive: true });
  await fs.writeFile(path.join(install, ".prime-knight-owner"), "codex-prime-knight-theme:v1\n");
  const token = "44444444444444444444444444444444";
  await writeRecordedProcess(state, "codex", { pid: 4242, start: "theme-start", token });
  await fs.writeFile(path.join(state, "port"), "9341\n");
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_process_alive() { [[ "$1" == "5252" ]] || { [[ "$1" == "4242" && ! -f "$PK_HOME/codex-stopped" ]]; }; };',
    'pk_process_uid() { /usr/bin/id -u; };',
    'pk_process_start() { [[ "$1" == "4242" ]] && printf "theme-start\\n" || printf "native-start\\n"; };',
    `pk_process_command() { [[ "$1" == "4242" ]] && printf "Codex --remote-debugging-address=127.0.0.1 --remote-debugging-port=9341 --prime-knight-launch-token=${token} --user-data-dir=$PK_PROFILE_DIR\\n" || printf "Codex native\\n"; };`,
    'pk_signal_process() { [[ "$2" == "4242" ]] || return 1; printf "stopped\\n" > "$PK_HOME/codex-stopped"; printf "signal:%s\\n" "$2" >> "$ACTION_LOG"; };',
    'pk_send_remove_payload() { printf "remove\\n" >> "$ACTION_LOG"; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  const result = await runSourced("scripts/restore-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await fs.readFile(actionLog, "utf8")).trim().split("\n"), ["remove", "signal:4242", "open"]);
});

test("verify refuses renderer access before exact theme Codex identity is confirmed", async (t) => {
  const home = await temporaryHome(t);
  const actionLog = path.join(home, "actions.log");
  const body = [
    'pk_require_supported_environment() { pk_validate_home; PK_NODE="/usr/bin/true"; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_verify_installation_manifest() { :; };',
    'pk_verify_package_metadata() { :; };',
    'pk_verified_theme_pid() { printf "3131\\n"; };',
    'pk_recorded_theme_port() { printf "9341\\n"; };',
    'pk_verified_theme_codex_identity() { return 1; };',
    'pk_verify_renderer() { printf "renderer\\n" >> "$ACTION_LOG"; };',
    'verify_main'
  ].join(" ");
  const result = await runSourced("scripts/verify-macos.sh", body, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 1, result.stderr);
  await assert.rejects(fs.access(actionLog));
});

test("fresh install then verify leaves no runtime record and restore stays idempotent", async (t) => {
  const home = await temporaryHome(t);
  const installBody = [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'install_main'
  ].join(" ");
  let result = await runSourced("scripts/install-macos.sh", installBody, { env: { HOME: home } });
  assert.equal(result.status, 0, result.stderr);

  const verifyBody = [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_require_cdp_capability() { :; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'verify_main'
  ].join(" ");
  result = await runSourced("scripts/verify-macos.sh", verifyBody, { env: { HOME: home } });
  assert.equal(result.status, 1);

  const actionLog = path.join(home, "restore-actions.log");
  const restoreBody = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  result = await runSourced("scripts/restore-macos.sh", restoreBody, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(actionLog, "utf8"), "open\n");
  await assert.rejects(fs.access(path.join(installDirectory(home), ".state")));
});

test("start capability failure creates no runtime record and restore stays idempotent", async (t) => {
  const home = await temporaryHome(t);
  const installBody = [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'install_main'
  ].join(" ");
  let result = await runSourced("scripts/install-macos.sh", installBody, { env: { HOME: home } });
  assert.equal(result.status, 0, result.stderr);

  const startBody = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_require_cdp_capability() { return 2; };',
    'start_main'
  ].join(" ");
  result = await runSourced("scripts/start-macos.sh", startBody, { env: { HOME: home } });
  assert.equal(result.status, 2, result.stderr);

  const actionLog = path.join(home, "restore-actions.log");
  const restoreBody = [
    'pk_require_supported_environment() { pk_validate_home; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_open_codex_native() { printf "open\\n" >> "$ACTION_LOG"; };',
    'restore_main'
  ].join(" ");
  result = await runSourced("scripts/restore-macos.sh", restoreBody, { env: { HOME: home, ACTION_LOG: actionLog } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(actionLog, "utf8"), "open\n");
  await assert.rejects(fs.access(path.join(installDirectory(home), ".state")));
});

test("installation verification rejects a modified owned file", async (t) => {
  const home = await temporaryHome(t);
  const installBody = [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'install_main'
  ].join(" ");
  let result = await runSourced("scripts/install-macos.sh", installBody, { env: { HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  await fs.appendFile(path.join(installDirectory(home), "src/runtime/injector.mjs"), "\n// modified\n");

  const verifyBody = [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'pk_verify_renderer() { :; };',
    'verify_main'
  ].join(" ");
  result = await runSourced("scripts/verify-macos.sh", verifyBody, { env: { HOME: home } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /checksum/i);
});

test("installation verification never follows a predictable state-file symlink", async (t) => {
  const home = await temporaryHome(t);
  const installBody = [
    'pk_require_supported_environment() { pk_validate_home; pk_require_node; };',
    'pk_discover_codex_app() { printf "/fake/Codex.app\\n"; };',
    'pk_verify_codex_signature() { :; };',
    'install_main'
  ].join(" ");
  let result = await runSourced("scripts/install-macos.sh", installBody, { env: { HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  const outside = path.join(home, "outside-sentinel");
  await fs.writeFile(outside, "untouched\n");

  const verifyBody = [
    'pk_initialize_paths "$script_path";',
    '/bin/mkdir -p "$PK_STATE_DIR";',
    '/bin/ln -s "$OUTSIDE" "$PK_STATE_DIR/manifest-check.$$";',
    'pk_verify_installation_manifest'
  ].join(" ");
  result = await runSourced("scripts/common-macos.sh", verifyBody, {
    env: { HOME: home, OUTSIDE: outside }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(outside, "utf8"), "untouched\n");
});
