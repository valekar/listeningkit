import assert from "node:assert/strict";
import test from "node:test";

import { envValue, modelForProvider, setDefaultModel } from "../src/provider.mjs";

test("provider names resolve only to the two ACP models", () => {
  assert.equal(modelForProvider("codex"), "codex-acp");
  assert.equal(modelForProvider("Claude"), "claude-acp");
  assert.equal(modelForProvider("claude-acp"), "claude-acp");
  assert.throws(() => modelForProvider("other"), /Choose codex or claude/);
});

test("selection changes the effective default without touching endpoint or token", () => {
  const source = [
    "# ENGINE_MODEL=old-example",
    "ENGINE_BASE_URL=http://host.docker.internal:3182/v1",
    "ENGINE_MODEL=codex-acp",
    "ENGINE_API_KEY=local-secret",
    "ENGINE_MODEL=older-duplicate",
    "",
  ].join("\n");
  const changed = setDefaultModel(source, "claude-acp");
  assert.equal(envValue(changed, "ENGINE_MODEL"), "claude-acp");
  assert.equal(changed.match(/^ENGINE_MODEL=/gm)?.length, 1);
  assert.ok(changed.includes("# ENGINE_MODEL=old-example"));
  assert.equal(envValue(changed, "ENGINE_API_KEY"), "local-secret");
  assert.equal(envValue(changed, "ENGINE_BASE_URL"), "http://host.docker.internal:3182/v1");
});
