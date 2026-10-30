import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

const root = fileURLToPath(new URL("../../", import.meta.url));
const native = path.join(root, "bindings");
const args = process.argv.slice(2);
if (args.length > 16) throw new Error("Too many release arguments");
const {values} = parseArgs({
  args,
  options: {"dist-tag": {type: "string", default: "latest"}, "dry-run": {type: "boolean", default: false}},
  strict: false,
});

function run(args, cwd = root) {
  const result = spawnSync("pnpm", args, {cwd, stdio: "inherit"});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`pnpm exited with ${result.status ?? result.signal}`);
}

function isPublished(spec) {
  const result = spawnSync("npm", ["view", spec, "version"], {cwd: root, encoding: "utf8"});
  if (result.error) throw result.error;
  if (result.status === 0) return true;
  if (result.stderr.includes("E404")) return false;
  throw new Error(`npm view ${spec} failed: ${result.stderr.trim()}`);
}

const manifestPath = path.join(native, "package.json");
const manifest = fs.readFileSync(manifestPath);
const {name, version} = JSON.parse(manifest.toString());

// zapi publishes the main package after all platform packages and never skips existing versions,
// so skip it entirely when the main package exists to keep a failed release re-runnable.
if (isPublished(`${name}@${version}`)) {
  // biome-ignore lint/suspicious/noConsole: Release logs need to show why native publishing was skipped
  console.log(`${name}@${version} is already published, skipping native packages`);
} else {
  run([
    "--filter",
    "@lodestar/native",
    "exec",
    "zapi",
    "build-artifacts",
    "--optimize",
    "ReleaseSafe",
    "--zig-cwd",
    "..",
    "--artifacts-dir",
    path.join(native, "artifacts"),
  ]);
  try {
    run(["exec", "zapi", "prepublish"], native);
    run(
      [
        "exec",
        "zapi",
        "publish",
        ...(values["dry-run"] ? ["--dry-run"] : []),
        "--",
        "--access",
        "public",
        "--ignore-scripts",
        "--provenance",
        "--tag",
        values["dist-tag"],
      ],
      native
    );
  } finally {
    // zapi adds release-only optionalDependencies; restore the workspace manifest before Lerna checks Git.
    fs.writeFileSync(manifestPath, manifest);
  }
}
if (!values["dry-run"]) run(["exec", "lerna", "publish", "from-package", "--yes", "--no-verify-access", ...args]);
