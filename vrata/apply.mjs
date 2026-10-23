import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function applyDistribution(root, distributionRoot) {
  const config = JSON.parse(
    await readFile(resolve(distributionRoot, "distribution.json"), "utf8"),
  );
  assert.match(config.releaseRepository, /^[a-zA-Z0-9-]+\/[a-zA-Z0-9._-]+$/);
  assert.match(config.version, /^\d+\.\d+\.\d+$/);
  const files = new Map();
  async function read(file) {
    if (!files.has(file))
      files.set(file, await readFile(resolve(root, file), "utf8"));
    return files.get(file);
  }
  async function replace(file, before, after, count = 1) {
    const source = await read(file);
    assert.equal(
      source.split(before).length - 1,
      count,
      `Upstream changed: ${file}: ${before}`,
    );
    files.set(file, source.replaceAll(before, after));
  }
  async function json(file, change) {
    const value = JSON.parse(await read(file));
    change(value);
    files.set(file, `${JSON.stringify(value, null, 2)}\n`);
  }

  await json("apps/desktop/package.json", (value) => {
    assert.equal(
      value.version,
      config.upstream.version,
      "Unexpected BB version or already prepared checkout",
    );
    value.version = config.version;
    value.scripts["desktop:build"] = value.scripts["desktop:build"].replace(
      "--publish always",
      "--publish never",
    );
  });
  const releaseUrl = `https://github.com/${config.releaseRepository}/releases/download/`;
  const channelFile = "apps/desktop/scripts/desktop-release-channel.mjs";
  const providerFile = "apps/desktop/src/desktop-update-provider.ts";
  for (const file of [channelFile, providerFile]) {
    await replace(
      file,
      "https://github.com/get-bb/bb/releases/download/",
      releaseUrl,
    );
  }
  for (const [before, after] of [
    ['appId: "dev.bb.desktop"', `appId: ${JSON.stringify(config.appId)}`],
    [
      'appId: "dev.bb.desktop.nightly"',
      `appId: ${JSON.stringify(`${config.appId}.nightly`)}`,
    ],
    [
      'applicationName: "bb"',
      `applicationName: ${JSON.stringify(config.productName)}`,
    ],
    [
      'applicationName: "bb Nightly"',
      `applicationName: ${JSON.stringify(`${config.productName} Nightly`)}`,
    ],
    [
      'artifactName: "${productName}-${version}-${arch}.${ext}"',
      'artifactName: "vrata-bb-${version}-${arch}.${ext}"',
    ],
    [
      'artifactName: "bb-nightly-${version}-${arch}.${ext}"',
      'artifactName: "vrata-bb-nightly-${version}-${arch}.${ext}"',
    ],
    ['linuxExecutableName: "bb"', 'linuxExecutableName: "vrata-bb"'],
    [
      'linuxExecutableName: "bb-nightly"',
      'linuxExecutableName: "vrata-bb-nightly"',
    ],
    ['windowsInstallName: "bb"', 'windowsInstallName: "vrata-bb"'],
    [
      'windowsInstallName: "bb-nightly"',
      'windowsInstallName: "vrata-bb-nightly"',
    ],
  ])
    await replace(channelFile, before, after);
  await replace(
    providerFile,
    'applicationName: "bb" | "bb Nightly";',
    "applicationName: string;",
  );
  await replace(
    providerFile,
    'applicationName: nightly ? "bb Nightly" : "bb",',
    `applicationName: nightly ? ${JSON.stringify(`${config.productName} Nightly`)} : ${JSON.stringify(config.productName)},`,
  );
  const declarations = "apps/desktop/scripts/desktop-release-channel.d.mts";
  for (const [field, values] of [
    ["appId", '"dev.bb.desktop" | "dev.bb.desktop.nightly"'],
    ["applicationName", '"bb" | "bb Nightly"'],
    ["linuxExecutableName", '"bb" | "bb-nightly"'],
    ["windowsInstallName", '"bb" | "bb-nightly"'],
  ])
    await replace(declarations, `${field}: ${values};`, `${field}: string;`);
  await json("apps/desktop/electron-builder.config.json", (value) => {
    value.appId = config.appId;
    value.productName = config.productName;
    value.artifactName = "vrata-bb-${version}-${arch}.${ext}";
    value.publish = [
      {
        channel: "latest",
        provider: "generic",
        url: `${releaseUrl}desktop-latest/`,
      },
    ];
  });
  await replace(
    "packages/config/src/runtime.ts",
    'const BB_PROD_DATA_DIR_NAME = ".bb";',
    `const BB_PROD_DATA_DIR_NAME = ${JSON.stringify(config.dataDirectory)};`,
  );
  await replace(
    "packages/config/src/runtime.ts",
    "BB_PROD_SERVER_PORT = 38886;",
    `BB_PROD_SERVER_PORT = ${config.serverPort};`,
  );
  await replace(
    "packages/config/src/runtime.ts",
    "BB_PROD_HOST_DAEMON_PORT = 38887;",
    `BB_PROD_HOST_DAEMON_PORT = ${config.hostDaemonPort};`,
  );
  await replace(
    "apps/desktop/src/types.ts",
    "DEFAULT_BB_SERVER_PORT = 38886;",
    `DEFAULT_BB_SERVER_PORT = ${config.serverPort};`,
  );
  await replace(
    "apps/desktop/src/main.ts",
    'return join(args.homeDir, ".bb");',
    `return join(args.homeDir, ${JSON.stringify(config.dataDirectory)});`,
  );
  await replace(
    "packages/domain/src/app-settings.ts",
    "  defaultProviderId: null,",
    '  defaultProviderId: "vrata",',
  );
  await replace(
    "apps/app/src/App.tsx",
    'from "./components/onboarding/OnboardingGate";',
    'from "./components/onboarding/VrataOnboardingGate";',
  );
  await replace(
    "apps/server/src/services/plugins/builtin-registry.ts",
    "export const BUILTIN_PLUGINS = [\n",
    'export const BUILTIN_PLUGINS = [\n  { name: "vrata", pluginId: "vrata", defaultEnabled: true },\n',
  );
  await json("packages/bundled-plugins/package.json", (value) => {
    value.dependencies["bb-plugin-vrata"] = "workspace:*";
  });
  await json("plugins/bb-official.json", (value) => {
    assert.equal(value.vrata, undefined, "Upstream already contains Vrata");
    value.vrata = { category: "agents-and-providers", screenshots: [] };
  });
  await replace(
    "turbo.json",
    '    "prepare:bundled": {',
    '    "bb-plugin-vrata#test": {\n      "dependsOn": ["prepare:bundled"],\n      "cache": false\n    },\n    "bb-plugin-vrata#typecheck": {\n      "dependsOn": ["@get-bb/plugin-sdk#build:types", "topo"]\n    },\n    "bb-plugin-vrata#prepare:bundled": {\n      "dependsOn": ["topo", "^build"],\n      "inputs": ["**/*", "!node_modules/**", "!dist/**", "!.bundled-runtime/**"],\n      "outputs": [".bundled-runtime/**"]\n    },\n    "prepare:bundled": {',
  );

  for (const [file, content] of files)
    await writeFile(resolve(root, file), content);
  for (const file of [
    "VrataOnboardingGate.tsx",
    "VrataOnboardingGate.test.tsx",
  ]) {
    await cp(
      resolve(distributionRoot, file),
      resolve(root, "apps/app/src/components/onboarding", file),
    );
  }
  await cp(
    resolve(distributionRoot, "VrataDistribution.test.ts"),
    resolve(root, "apps/desktop/test/VrataDistribution.test.ts"),
  );
  return {
    files: [...files.keys()],
    version: config.version,
    upstreamVersion: config.upstream.version,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? ".");
  const distributionRoot = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
  );
  console.log(JSON.stringify(await applyDistribution(root, distributionRoot)));
}
