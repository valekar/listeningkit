import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { AcpError, runAcpPrompt } from "../src/acp.mjs";
import { createBridge, parseAgentJson } from "../src/api.mjs";

const fakeAgent = fileURLToPath(new URL("./fake-agent.mjs", import.meta.url));
const schema = {
  type: "object",
  properties: { score: { type: "number" }, reason: { type: "string" } },
  required: ["score", "reason"],
  additionalProperties: false,
};

test("ACP client completes a fresh session and reads text chunks", async () => {
  const text = await runAcpPrompt("codex-acp", "Classify this", { agentPathOverride: fakeAgent, timeoutMs: 5_000 });
  assert.deepEqual(JSON.parse(text), { score: 0.9, reason: "A buyer question" });
});

test("ACP client rejects agent tool calls", async () => {
  await assert.rejects(
    runAcpPrompt("claude-acp", "ATTEMPT_TOOL", { agentPathOverride: fakeAgent, timeoutMs: 5_000 }),
    (error) => error instanceof AcpError && error.message === "ACP agent attempted a tool call",
  );
});

test("bridge serves both models and protects requests with a token", async () => {
  const calls = [];
  const server = createBridge({
    token: "a".repeat(40),
    runAgent: async (model, prompt) => {
      calls.push({ model, prompt });
      return '{"score":0.9,"reason":"A buyer question"}';
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const unauthorized = await fetch(`${base}/v1/models`);
    assert.equal(unauthorized.status, 401);

    const headers = { authorization: `Bearer ${"a".repeat(40)}` };
    const models = await (await fetch(`${base}/v1/models`, { headers })).json();
    assert.deepEqual(models.data.map((item) => item.id), ["codex-acp", "claude-acp"]);

    for (const model of ["codex-acp", "claude-acp"]) {
      const response = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: "Score relevance" }, { role: "user", content: "Buyer asks about EMI" }],
          response_format: { type: "json_schema", json_schema: { name: "judgment", schema } },
        }),
      });
      assert.equal(response.status, 200);
      const reply = await response.json();
      assert.equal(JSON.parse(reply.choices[0].message.content).score, 0.9);
    }
    assert.equal(calls.length, 2);
    assert.ok(calls.every((call) => call.prompt.includes("Do not use tools")));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("bridge rejects invalid agent output", () => {
  assert.throws(() => parseAgentJson('{"score":1.5,"reason":"wrong"}', schema), /invalid score/);
  assert.throws(() => parseAgentJson('{"score":0.8,"reason":"ok","extra":1}', schema), /extra JSON fields/);
  assert.throws(() => parseAgentJson("not json", schema), /did not return a JSON object/);
});
