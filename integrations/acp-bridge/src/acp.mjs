import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";

import * as acp from "@agentclientprotocol/sdk";

export const AGENTS = Object.freeze({
  "codex-acp": {
    packageName: "@agentclientprotocol/codex-acp",
    binary: "dist/index.js",
    env: { INITIAL_AGENT_MODE: "read-only", NO_BROWSER: "1" },
  },
  "claude-acp": {
    packageName: "@agentclientprotocol/claude-agent-acp",
    binary: "dist/index.js",
    env: {},
  },
});

const INHERITED_ENV = [
  "PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL",
  "CODEX_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_EXECUTABLE",
  "CODEX_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY",
];

export class AcpError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = "AcpError";
    this.status = status;
  }
}

function adapterPath(agent) {
  return fileURLToPath(new URL(`../node_modules/${agent.packageName}/${agent.binary}`, import.meta.url));
}

function agentEnv(agent) {
  const env = {};
  for (const key of INHERITED_ENV) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, ...agent.env };
}

function signalProcess(child, signal) {
  if (child.pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The process group may already be gone.
    }
  }
  child.kill(signal);
}

async function stopProcess(child) {
  signalProcess(child, "SIGTERM");
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signalProcess(child, "SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function runAcpPrompt(model, prompt, { timeoutMs = 120_000, agentPathOverride } = {}) {
  const agent = AGENTS[model];
  if (!agent && !agentPathOverride) throw new AcpError(`Unknown ACP model: ${model}`, 400);

  // One fresh, empty workspace and one process per post. No MCP servers or file
  // capabilities are offered to agents processing untrusted source content.
  const cwd = await mkdtemp(join(tmpdir(), "openmagpie-acp-"));
  const child = spawn(process.execPath, [agentPathOverride ?? adapterPath(agent)], {
    cwd,
    env: agent ? agentEnv(agent) : agentEnv({ env: {} }),
    detached: process.platform !== "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();

  let timer;
  try {
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout),
    );
    const client = acp.client({ name: "openmagpie-acp-bridge" })
      .onRequest(acp.methods.client.session.requestPermission, async () => ({
        outcome: { outcome: "cancelled" },
      }))
      .onRequest(acp.methods.client.fs.readTextFile, async () => {
        throw new Error("File access is disabled for OpenMagpie scoring");
      })
      .onRequest(acp.methods.client.fs.writeTextFile, async () => {
        throw new Error("File access is disabled for OpenMagpie scoring");
      });

    const work = client.connectWith(stream, async (ctx) => {
      await ctx.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {},
      });
      const sessionRequest = {
        cwd,
        mcpServers: [],
        ...(model === "claude-acp" ? {
          _meta: {
            claudeCode: {
              options: {
                tools: [],
                settingSources: [],
                mcpServers: {},
                allowDangerouslySkipPermissions: false,
              },
            },
          },
        } : {}),
      };
      return ctx.buildSession(sessionRequest).withSession(async (session) => {
        let output = "";
        let attemptedTool = false;
        session.prompt(prompt);
        for (;;) {
          const update = await session.nextUpdate();
          if (update.kind === "stop") {
            if (update.stopReason !== "end_turn") {
              throw new AcpError(`ACP agent stopped: ${update.stopReason}`, 502);
            }
            if (attemptedTool) throw new AcpError("ACP agent attempted a tool call", 502);
            return output;
          }
          const event = update.notification.update;
          if (event.sessionUpdate === "tool_call") attemptedTool = true;
          if (event.sessionUpdate === "agent_message_chunk" && event.content.type === "text") {
            output += event.content.text;
            if (output.length > 65_536) throw new AcpError("ACP response exceeded size limit", 502);
          }
        }
      });
    });

    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AcpError("ACP agent timed out", 504)), timeoutMs);
    });
    return await Promise.race([work, timeout]);
  } catch (error) {
    if (error instanceof AcpError) throw error;
    throw new AcpError(`${model} unavailable or not authenticated: ${error.message}`);
  } finally {
    clearTimeout(timer);
    await stopProcess(child);
    await rm(cwd, { recursive: true, force: true });
  }
}
