import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cp,
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyDistribution } from "./apply.mjs";
import { fetchPluginPackage, readPluginConfig } from "./plugin-package.mjs";

const distributionRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? ".",
);
const config = JSON.parse(
  await readFile(resolve(distributionRoot, "distribution.json"), "utf8"),
);
const current = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
execFileSync(
  "git",
  ["merge-base", "--is-ancestor", config.upstream.commit, current],
  { cwd: root },
);
const target = resolve(root, "plugins/vrata");
assert.equal(
  execFileSync("git", ["ls-files", "plugins/vrata"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  "",
  "Refusing to replace tracked plugin sources",
);
assert.equal(
  await lstat(target).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  ),
  false,
  "plugins/vrata already exists; use a clean checkout",
);
const patch = resolve(distributionRoot, "pnpm-lock.patch");
if (!process.argv.includes("--refresh-lock"))
  execFileSync("git", ["apply", "--check", patch], { cwd: root });
const staging = await mkdtemp(resolve(tmpdir(), "vrata-plugin-"));
try {
  const plugin = await fetchPluginPackage(
    staging,
    await readPluginConfig(distributionRoot),
  );
  await rename(resolve(staging, "dist"), resolve(staging, "published-dist"));
  const manifest = JSON.parse(
    await readFile(resolve(staging, "package.json"), "utf8"),
  );
  manifest.vrataDistribution = "vrata-bb";
  assert.equal(manifest.bb.app, "./src/app.tsx");
  const appPath = resolve(staging, "src/app.tsx");
  const appSource = await readFile(appPath, "utf8");
  await writeFile(
    appPath,
    appSource.replace(
      'app.slots.experimental_providerIcon({ providerId: "vrata", icon: VrataIcon });',
      'app.slots.experimental_providerIcon({ providerKind: "agent", providerId: "vrata", icon: VrataIcon });',
    ),
  );
  manifest.dependencies["@get-bb/plugin-sdk"] = "workspace:*";
  const sdk = JSON.parse(
    await readFile(resolve(root, "packages/plugin-sdk/package.json"), "utf8"),
  );
  manifest.devDependencies = { "@bb/plugin-build": "workspace:*" };
  for (const name of ["@types/node", "@types/react", "react", "typescript"])
    manifest.devDependencies[name] = sdk.devDependencies[name];
  manifest.scripts = {
    "prepare:bundled":
      "node --conditions=source --import tsx ../../vrata/prepare-plugin.mjs",
    typecheck: "tsc --noEmit",
    test: "node --conditions=source --import tsx --test ../../vrata/runtime-check.mjs",
  };
  await writeFile(
    resolve(staging, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    resolve(staging, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          resolveJsonModule: true,
          jsx: "react-jsx",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: ["node"],
        },
        files: [manifest.bb.server, manifest.bb.app],
      },
      null,
      2,
    )}\n`,
  );
  const result = await applyDistribution(root, distributionRoot);
  await cp(staging, target, { recursive: true });
  if (process.argv.includes("--refresh-lock")) {
    execFileSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      [
        "install",
        "--lockfile-only",
        "--ignore-scripts",
        "--no-frozen-lockfile",
      ],
      { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
    );
    await writeFile(
      patch,
      execFileSync("git", ["diff", "--", "pnpm-lock.yaml"], {
        cwd: root,
        maxBuffer: 20 * 1024 * 1024,
      }),
    );
  } else {
    execFileSync("git", ["apply", patch], { cwd: root });
  }
  console.log(JSON.stringify({ ...result, plugin }));
} finally {
  await rm(staging, { recursive: true, force: true });
}
