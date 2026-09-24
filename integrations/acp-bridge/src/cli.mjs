#!/usr/bin/env node
import { createBridge } from "./api.mjs";

const host = process.env.OPENMAGPIE_ACP_BIND ?? "127.0.0.1";
const port = Number(process.env.OPENMAGPIE_ACP_PORT ?? "3182");
const token = process.env.OPENMAGPIE_ACP_TOKEN ?? "";
const timeoutMs = Number(process.env.OPENMAGPIE_ACP_TIMEOUT_MS ?? "120000");

if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(timeoutMs) || timeoutMs < 1000) {
  throw new Error("Invalid ACP bridge port or timeout");
}

const server = createBridge({ token, timeoutMs });
server.listen(port, host, () => {
  process.stdout.write(`OpenMagpie ACP bridge listening on ${host}:${port}\n`);
});
