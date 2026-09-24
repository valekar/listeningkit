#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const name = "com.propnewz.openmagpie-acp-bridge";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plist = join(homedir(), "Library", "LaunchAgents", `${name}.plist`);
const domain = `gui/${process.getuid()}`;

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function launchctl(...args) {
  return spawnSync("launchctl", args, { stdio: "inherit" }).status === 0;
}

if (process.platform !== "darwin") throw new Error("This service installer supports macOS only");
const action = process.argv[2];
if (!["install", "remove"].includes(action)) throw new Error("Use install or remove");

if (action === "remove") {
  try {
    await access(plist);
    launchctl("bootout", domain, plist);
  } catch {
    // The service has not been installed.
  }
  await rm(plist, { force: true });
  process.stdout.write(`Removed ${name}\n`);
} else {
  await access(join(root, ".env"));
  await mkdir(dirname(plist), { recursive: true });
  await mkdir(join(root, ".logs"), { recursive: true });
  const stablePath = [dirname(process.execPath), join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  const args = [process.execPath, `--env-file=${join(root, ".env")}`, join(root, "src", "cli.mjs")];
  const programArgs = args.map((arg) => `      <string>${escapeXml(arg)}</string>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${name}</string>
    <key>ProgramArguments</key><array>
${programArgs}
    </array>
    <key>WorkingDirectory</key><string>${escapeXml(root)}</string>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${escapeXml(join(root, ".logs", "stdout.log"))}</string>
    <key>StandardErrorPath</key><string>${escapeXml(join(root, ".logs", "stderr.log"))}</string>
    <key>EnvironmentVariables</key><dict>
      <key>HOME</key><string>${escapeXml(homedir())}</string>
      <key>PATH</key><string>${escapeXml(stablePath)}</string>
    </dict>
  </dict>
</plist>
`;
  try {
    await access(plist);
    launchctl("bootout", domain, plist);
  } catch {
    // First install.
  }
  await writeFile(plist, xml, { mode: 0o600 });
  if (!launchctl("bootstrap", domain, plist)) throw new Error("launchctl bootstrap failed");
  process.stdout.write(`Installed ${name}\n`);
}
