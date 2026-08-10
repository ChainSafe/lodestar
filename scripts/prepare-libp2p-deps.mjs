import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsLibp2pRoot = path.join(repoRoot, "temp-deps", "js-libp2p");
// Prevent caret ranges from resolving package releases newer than this checkout.
const jsLibp2pDependencyCutoff = "2026-07-31T23:59:59.000Z";
// Build the linked packages and their workspace dependencies in dependency order.
const jsLibp2pPackages = [
  "@libp2p/interface",
  "@libp2p/crypto",
  "@libp2p/peer-id",
  "@libp2p/logger",
  "@libp2p/utils",
  "@libp2p/tcp",
  "@libp2p/peer-collections",
  "@libp2p/interface-internal",
  "@libp2p/multistream-select",
  "@libp2p/peer-record",
  "@libp2p/peer-store",
  "libp2p",
];

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.error !== undefined) {
    console.error(`Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("git", ["submodule", "update", "--init", "--recursive", "--remote", "temp-deps/js-libp2p"], repoRoot);
// Aegir's listr dependency needs an observable implementation resolvable from the workspace root.
run(
  "npm",
  [
    "install",
    "rxjs@7.8.2",
    `--before=${jsLibp2pDependencyCutoff}`,
    "--no-save",
    "--package-lock=false",
    "--no-audit",
    "--no-fund",
  ],
  jsLibp2pRoot
);

for (const packageName of jsLibp2pPackages) {
  run("npm", ["run", "build", "--workspace", packageName], jsLibp2pRoot);
}
