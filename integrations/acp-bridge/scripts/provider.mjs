#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { envValue, modelForProvider, setDefaultModel } from "../src/provider.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const coreEnvPath = join(repo, "apps/core/.env");
const bridgeEnvPath = join(repo, "integrations/acp-bridge/.env");

function docker(args, { output = false } = {}) {
  const result = spawnSync("docker", ["compose", ...args], {
    cwd: repo,
    encoding: "utf8",
    stdio: output ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(output ? (result.stderr || result.stdout).trim() : `docker compose ${args[0]} failed`);
  }
  return output ? result.stdout.trim() : "";
}

function liveModel() {
  try {
    return docker(["exec", "-T", "core", "printenv", "ENGINE_MODEL"], { output: true });
  } catch {
    return "unavailable";
  }
}

async function writeEnv(path, content, mode) {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, content, { mode });
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}

async function selectProvider(name) {
  const model = modelForProvider(name);
  const coreEnv = await readFile(coreEnvPath, "utf8");
  const bridgeEnv = await readFile(bridgeEnvPath, "utf8");
  const port = envValue(bridgeEnv, "OPENMAGPIE_ACP_PORT") || "3182";
  const endpoint = `http://host.docker.internal:${port}/v1`;
  const token = envValue(bridgeEnv, "OPENMAGPIE_ACP_TOKEN");
  if (envValue(coreEnv, "ENGINE_BASE_URL") !== endpoint || !token || envValue(coreEnv, "ENGINE_API_KEY") !== token) {
    throw new Error("ListeningKit is not configured for this ACP bridge. Check its endpoint and local token.");
  }
  const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || !(await response.json()).data?.some((item) => item.id === model)) {
    throw new Error(`${model} is not available from the ACP bridge`);
  }
  if (envValue(coreEnv, "ENGINE_MODEL") === model && liveModel() === model) {
    process.stdout.write(`ListeningKit already uses ${model}\n`);
    return;
  }

  const mode = (await stat(coreEnvPath)).mode & 0o777;
  const changed = setDefaultModel(coreEnv, model);
  if (changed !== coreEnv) await writeEnv(coreEnvPath, changed, mode);
  try {
    docker(["up", "-d", "--wait", "--no-deps", "--force-recreate", "core"]);
    const status = docker(["exec", "-T", "core", "uv", "run", "--package", "openmagpie-core", "python", "apps/core/manage.py", "engine_status"], { output: true });
    if (!status.includes(`default model '${model}'`)) throw new Error(status || "Engine status did not confirm the selected model");
    process.stdout.write(`ListeningKit now uses ${model}\n${status}\n`);
  } catch (error) {
    if (changed !== coreEnv) await writeEnv(coreEnvPath, coreEnv, mode);
    try {
      docker(["up", "-d", "--wait", "--no-deps", "--force-recreate", "core"]);
    } catch {
      process.stderr.write("Could not restart the previous core configuration\n");
    }
    throw error;
  }
}

const [command, option] = process.argv.slice(2);
try {
  if (command === "status" && !option) {
    const configured = envValue(await readFile(coreEnvPath, "utf8"), "ENGINE_MODEL") || "unset";
    process.stdout.write(`Configured: ${configured}\nRunning core: ${liveModel()}\n`);
  } else if (command === "use" && option) {
    await selectProvider(option);
  } else {
    throw new Error("Usage: npm run provider -- status | use codex | use claude");
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
