import {createHash} from "node:crypto";
import {mkdir, readFile, readdir, realpath, stat, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {runBoundedCommand} from "./bounded_child.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [output, mode = "ordinary"] = process.argv.slice(2);
if (!output || !["ordinary", "instrumented"].includes(mode) || process.argv.length > 4) {
  throw new Error("Usage: node scripts/build_classic_level.mjs <new-evidence-directory> [ordinary|instrumented]");
}
await mkdir(output, {recursive: false});
const evidence = {mode, node: process.version, commands: [], files: []};
async function identity(path) {
  const metadata = await stat(path);
  if (metadata.size > 32 * 1024 * 1024) throw new Error(`ClassicLevelIdentityTooLarge: ${path}`);
  const data = await readFile(path);
  return {path, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex")};
}
async function run(program, args, cwd, env = process.env) {
  try {
    const record = await runBoundedCommand(program, args, cwd, {env, maxOutputBytes: 1024 * 1024, timeoutMs: 240000});
    evidence.commands.push(record);
    return record;
  } catch (error) {
    if (error.commandRecord) evidence.commands.push(error.commandRecord);
    throw error;
  }
}
try {
  if (Number(process.versions.napi) < 7) throw new Error("ClassicLevelRequiresNapi7");
  if (process.env.PREBUILDS_ONLY || process.env.CLASSIC_LEVEL_PREBUILD) throw new Error("ClassicLevelLoaderOverride");
  const require = createRequire(join(root, "packages/db/package.json"));
  const entry = require.resolve("classic-level");
  const packageRoot = dirname(await realpath(entry));
  const dependencyRequire = createRequire(entry);
  const patch = await identity(join(root, "patches/classic-level@1.4.1.patch"));
  if (!packageRoot.includes(`classic-level@1.4.1_patch_hash=${patch.sha256}/`)) throw new Error("ClassicLevelPatchIdentityMismatch");
  const workspace = await readFile(join(root, "pnpm-workspace.yaml"), "utf8");
  const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
  if (!workspace.includes("classic-level@1.4.1: patches/classic-level@1.4.1.patch") || !lock.includes(`classic-level@1.4.1: ${patch.sha256}`)) {
    throw new Error("ClassicLevelPatchRegistrationMismatch");
  }
  evidence.patch = patch;
  evidence.packageRoot = packageRoot;
  for (const name of ["binding.cc", "binding.gyp", "binding.js", "index.js", "index.d.ts", "iterator.js", "package.json"]) {
    evidence.files.push(await identity(join(packageRoot, name)));
  }
  const directories = [join(packageRoot, "deps")];
  let sourceBytes = 0;
  for (let index = 0; index < directories.length; index++) {
    if (directories.length > 128) throw new Error("ClassicLevelSourceDirectoryBound");
    const children = await readdir(directories[index], {withFileTypes: true});
    if (children.length > 1024) throw new Error("ClassicLevelSourceEntryBound");
    for (const child of children) {
      const path = join(directories[index], child.name);
      if (child.isDirectory()) directories.push(path);
      else if (child.isFile()) {
        if (evidence.files.length >= 1024) throw new Error("ClassicLevelSourceFileBound");
        const info = await stat(path);
        if (info.size > 8 * 1024 * 1024 || sourceBytes + info.size > 32 * 1024 * 1024) throw new Error("ClassicLevelSourceBytesBound");
        sourceBytes += info.size;
        evidence.files.push(await identity(path));
      } else throw new Error("ClassicLevelUnexpectedSourceEntry");
    }
  }
  const compiler = process.env.CXX || "c++";
  await run(compiler, ["--version"], root);
  const compilerPath = (await run("which", [compiler], root)).stdout.trim();
  evidence.compiler = await identity(await realpath(compilerPath));
  await run("python3", ["--version"], root);
  const gyp = dependencyRequire.resolve("node-gyp/bin/node-gyp.js");
  evidence.nodeGyp = await identity(gyp);
  const env = {...process.env, CXX: compiler, GYP_DEFINES: `classic_level_bounded_test=${mode === "instrumented" ? 1 : 0}`};
  evidence.buildEnvironment = {CXX: compiler, GYP_DEFINES: env.GYP_DEFINES};
  await run(process.execPath, [gyp, "rebuild", "--jobs=2"], packageRoot, env);
  evidence.buildConfig = await identity(join(packageRoot, "build/config.gypi"));
  const loader = dependencyRequire("node-gyp-build");
  const binary = loader.path(packageRoot);
  if (await realpath(binary) !== join(packageRoot, "build/Release/classic_level.node")) throw new Error("ClassicLevelSourceBuildNotSelected");
  const binding = dependencyRequire(join(packageRoot, "binding.js"));
  if (binding.boundedReadVersion !== 1 || ("bounded_test_stats" in binding) !== (mode === "instrumented")) {
    throw new Error("ClassicLevelBoundedCapabilityMismatch");
  }
  evidence.addon = await identity(binary);
  evidence.capability = binding.boundedReadVersion;
  evidence.exports = Object.getOwnPropertyNames(binding).sort();
  evidence.loader = await identity(dependencyRequire.resolve("node-gyp-build"));
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.error = {message: error.message, code: error.code};
  process.exitCode = 1;
} finally {
  await writeFile(join(output, "build.json"), JSON.stringify(evidence, null, 2) + "\n", {flag: "wx"});
  console.log(JSON.stringify({status: evidence.status, error: evidence.error, patch: evidence.patch, addon: evidence.addon, capability: evidence.capability, evidence: join(output, "build.json")}));
}
