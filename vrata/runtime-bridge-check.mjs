import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { experimental_createBridgeJsonRpcTestHarness } from "../packages/plugin-sdk/src/provider-bridge-testing.ts";
import { PROVIDER_BRIDGE_PROTOCOL_VERSION } from "../packages/plugin-sdk/src/provider-bridge.ts";

const root = await mkdtemp(resolve(tmpdir(), "vrata-npm-pi-"));
const previousCwd = process.cwd();
const requests = [];
const api = createServer(async (request, response) => {
  if (request.url === "/v1/models") {
    response.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        data: [
          {
            id: "gemini-3.8-flash",
            gateway_metadata: {
              supports_tools: true,
              verified_transport: "chat_completions",
            },
          },
        ],
      }),
    );
    return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push(JSON.parse(body));
  const toolCall = requests.length === 1;
  const delta = toolCall
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "write-proof",
            type: "function",
            function: {
              name: "write",
              arguments: JSON.stringify({
                path: "proof.txt",
                content: "npm Pi works",
              }),
            },
          },
        ],
      }
    : { role: "assistant", content: "Done" };
  const chunk = (value, finish_reason) =>
    `data: ${JSON.stringify({
      id: `completion-${requests.length}`,
      object: "chat.completion.chunk",
      created: 1,
      model: "gemini-3.8-flash",
      choices: [{ index: 0, delta: value, finish_reason }],
    })}\n\n`;
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.write(chunk(delta, null));
  response.write(chunk({}, toolCall ? "tool_calls" : "stop"));
  response.end("data: [DONE]\n\n");
});
let bridge;
let harness;
try {
  await copyFile(
    resolve(process.argv[2], "dist/host.js"),
    resolve(root, "host.mjs"),
  );
  await new Promise((done) => api.listen(0, "127.0.0.1", done));
  await writeFile(
    resolve(root, "credentials.json"),
    JSON.stringify({
      apiKey: "synthetic-key",
      baseUrl: `http://127.0.0.1:${api.address().port}`,
    }),
    { mode: 0o600 },
  );
  process.chdir(root);
  process.env.PATH = resolve(root, "empty-bin");
  process.env.PI_TELEMETRY = "off";
  ({ experimental_providerBridge: bridge } = await import(
    pathToFileURL(resolve(root, "host.mjs")).href
  ));
  await bridge.start({
    pluginId: "bb-plugin",
    dataDir: root,
    tempDir: resolve(root, "temp"),
  });
  harness = experimental_createBridgeJsonRpcTestHarness(bridge.handleLine);
  let nextId = 0;
  async function rpc(method, params) {
    const id = `check-${++nextId}`;
    harness.sendRequest(id, method, params);
    const reply = await harness.waitForResponse(id);
    assert.equal(reply.error, undefined, JSON.stringify(reply.error));
    return reply.result;
  }
  await rpc("initialize", {
    client: { name: "distribution-check", version: "1" },
    protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
  });
  const threadId = "thr_npm_distribution";
  const options = {
    model: "gemini-3.8-flash",
    reasoningLevel: "none",
    permissionMode: "full",
    permissionScope: "full",
    approvalReviewer: null,
    permissionEscalation: null,
  };
  const started = await rpc("thread/start", {
    threadId,
    cwd: root,
    instructionMode: "append",
    options,
  });
  await rpc("turn/start", {
    threadId,
    providerThreadId: started.providerThreadId,
    clientRequestId: "creq_2222222222",
    input: [{ type: "text", text: "Write proof.txt", mentions: [] }],
    options,
  });
  let boundary;
  for (let attempt = 0; attempt < 750; attempt++) {
    boundary = harness.messages
      .filter((message) => message.method === "thread/delta")
      .flatMap((message) => message.params.deltas)
      .find((delta) => delta.kind === "turn.boundary");
    if (boundary) break;
    await new Promise((done) => setTimeout(done, 20));
  }
  assert.equal(boundary?.status, "completed");
  assert.equal(
    await readFile(resolve(root, "proof.txt"), "utf8"),
    "npm Pi works",
  );
  assert.equal(requests.length, 2);
  await rpc("thread/stop", {
    threadId,
    providerThreadId: started.providerThreadId,
    activeTurnId: null,
    intent: "release",
  });
} finally {
  harness?.restore();
  await bridge?.onClose?.();
  api.closeAllConnections();
  await new Promise((done) => api.close(done));
  process.chdir(previousCwd);
  await rm(root, { recursive: true, force: true });
}
