import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const stream = acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
acp.agent({ name: "test-agent" })
  .onRequest(acp.methods.agent.initialize, async () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
  }))
  .onRequest(acp.methods.agent.session.new, async () => ({ sessionId: "test-session" }))
  .onRequest(acp.methods.agent.session.prompt, async (ctx) => {
    const text = ctx.params.prompt.map((part) => part.text ?? "").join("");
    if (text.includes("ATTEMPT_TOOL")) {
      await ctx.client.notify(acp.methods.client.session.update, {
        sessionId: ctx.params.sessionId,
        update: { sessionUpdate: "tool_call", toolCallId: "test-tool", title: "Read file", kind: "read", status: "pending" },
      });
    }
    await ctx.client.notify(acp.methods.client.session.update, {
      sessionId: ctx.params.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: '{"score":0.9,"reason":"A buyer question"}' },
      },
    });
    return { stopReason: "end_turn" };
  })
  .connect(stream);
