import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
  createFakePluginHost,
  makeHostResponse,
} from "../packages/plugin-sdk/src/testing/index.ts";
import { experimental_createHostEntryHarness } from "../packages/plugin-sdk/src/testing/host.ts";
import { PLUGIN_SDK_VERSION } from "../packages/domain/src/plugin-sdk-version.ts";

const pluginRoot = resolve(process.cwd(), ".bundled-runtime");

test("npm host stays byte-identical and server/app use the distribution SDK", async () => {
  const manifest = JSON.parse(
    await readFile(resolve(pluginRoot, "package.json"), "utf8"),
  );
  assert.equal(manifest.name, "@vrata-ai/bb-plugin");
  const distribution = JSON.parse(
    await readFile(
      resolve(process.cwd(), "../../vrata/distribution.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.version, distribution.plugin.version);
  for (const artifact of ["host", "server", "app"]) {
    assert.equal(manifest.bb[artifact], `./dist/${artifact}.js`);
    const meta = JSON.parse(
      await readFile(
        resolve(pluginRoot, "dist", `${artifact}.meta.json`),
        "utf8",
      ),
    );
    assert.equal(meta.pluginId, "bb-plugin");
    assert.equal(meta.pluginVersion, manifest.version);
    if (artifact !== "host") assert.equal(meta.sdkVersion, PLUGIN_SDK_VERSION);
    else {
      const bytes = await readFile(resolve(pluginRoot, "dist/host.js"));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        meta.artifactDigest,
      );
      assert.deepEqual(
        bytes,
        await readFile(resolve(process.cwd(), "published-dist/host.js")),
      );
    }
  }
});

test("onboarding and balance RPCs reach the published host through the current SDK", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "vrata-npm-onboarding-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const api = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url });
    if (request.headers.authorization !== "Bearer synthetic-key") {
      response.writeHead(401).end("rejected");
      return;
    }
    if (request.url === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "gemini-3.8-flash" }] }));
    } else if (request.url === "/v1/account") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          checked_at: "2026-10-24T00:00:00Z",
          balance: {
            currency: "RUB",
            unit: "coin_atoms",
            spendable: "1234567",
            paid_available: "1000000",
            promo_available: "234567",
            reserved: "0",
          },
        }),
      );
    } else response.writeHead(404).end();
  });
  await new Promise((done) => api.listen(0, "127.0.0.1", done));
  t.after(
    () =>
      new Promise((done) => {
        api.closeAllConnections();
        api.close(done);
      }),
  );
  const { default: host } = await import(
    pathToFileURL(resolve(pluginRoot, "dist/host.js")).href
  );
  const hostHarness = experimental_createHostEntryHarness(host, {
    experimental_paths: {
      dataDir: resolve(root, "host-data"),
      tempDir: resolve(root, "temp"),
    },
  });
  const machine = makeHostResponse({ id: "host-test", name: "Local" });
  const { bb, harness } = createFakePluginHost({
    pluginId: "bb-plugin",
    sdk: {
      hosts: { get: async () => machine },
      subscribe: () => () => {},
      system: { reloadConfig: async () => ({ ok: true }) },
    },
    experimental_callHostRpc: ({ method, input, hostId, signal }) => {
      assert.equal(hostId, machine.id);
      return hostHarness.experimental_call(method, input, { signal });
    },
  });
  t.after(async () => {
    await harness.lifecycle.dispose();
    await hostHarness.experimental_dispose();
  });
  const { default: plugin } = await import(
    pathToFileURL(resolve(pluginRoot, "dist/server.js")).href
  );
  await plugin(bb);
  const target = { kind: "host", hostId: machine.id };
  const rpc = (method, input) => harness.behavior.callRpc(method, input);
  assert.equal((await rpc("getConfiguration", { target })).configured, false);
  const baseUrl = `http://127.0.0.1:${api.address().port}`;
  const saved = await rpc("saveCredentials", {
    target,
    baseUrl,
    apiKey: "synthetic-key",
  });
  assert.equal(saved.configured, true);
  assert.equal(saved.hostId, machine.id);
  assert(!JSON.stringify(saved).includes("synthetic-key"));
  assert.deepEqual(await rpc("balance", { hostId: machine.id }), {
    status: "ok",
    checkedAt: "2026-10-24T00:00:00Z",
    spendable: "1234567",
    paid: "1000000",
    promo: "234567",
    reserved: "0",
  });
  const credentials = resolve(root, "bridge-data/credentials.json");
  const before = await readFile(credentials, "utf8");
  assert.equal(JSON.parse(before).apiKey, "synthetic-key");
  if (process.platform !== "win32")
    assert.equal((await stat(credentials)).mode & 0o777, 0o600);
  await assert.rejects(
    rpc("saveCredentials", { target, baseUrl, apiKey: "synthetic-rejected" }),
  );
  assert.equal(await readFile(credentials, "utf8"), before);
  assert(
    requests.every(
      ({ method, url }) =>
        method === "GET" && ["/v1/models", "/v1/account"].includes(url),
    ),
  );
  assert.equal(
    (await rpc("deleteCredentials", { hostId: machine.id })).configured,
    false,
  );
  await assert.rejects(readFile(credentials), { code: "ENOENT" });
});

test(
  "published Pi runs a tool turn without plugin sources or installed Pi",
  { timeout: 60_000 },
  async () => {
    const { NODE_TEST_CONTEXT, ...env } = process.env;
    await promisify(execFile)(
      process.execPath,
      [
        "--conditions=source",
        "--import",
        "tsx",
        fileURLToPath(new URL("./runtime-bridge-check.mjs", import.meta.url)),
        pluginRoot,
      ],
      { env, timeout: 55_000 },
    );
  },
);
