import {spawnSync} from "node:child_process";
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
run(["exec", "zapi", "prepublish", "--platforms-only"], native);
run(
  [
    "exec",
    "zapi",
    "publish",
    "--platforms-only",
    "--skip-existing",
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
// Lerna publishes @lodestar/native itself. Its prepack script pins the platform packages as
// optionalDependencies, so Lerna must run lifecycle scripts.
if (!values["dry-run"]) run(["exec", "lerna", "publish", "from-package", "--yes", "--no-verify-access", ...args]);
