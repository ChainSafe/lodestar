#!/usr/bin/env node

// Checks native package target coverage in the beacon-node and validator
// production dependency graphs, then scans their native (.node) binaries for
// unconditional AVX/AVX2 usage. Native modules that use AVX instructions MUST
// have CPUID-based runtime dispatch to fall back on CPUs without AVX support
// (e.g. Intel Atom/Celeron).
//
// Catches issues like https://github.com/ChainSafe/lodestar/issues/9042
// where a dependency was compiled with hard-coded -C target-feature=+avx2.

import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rootManifests = ["packages/beacon-node/package.json", "packages/validator/package.json"];

const requiredTargets = [
  {name: "aarch64-apple-darwin", aliases: ["aarch64-apple-darwin", "darwin-arm64"]},
  {name: "aarch64-unknown-linux-gnu", aliases: ["aarch64-unknown-linux-gnu", "linux-arm64-gnu"]},
  {name: "aarch64-unknown-linux-musl", aliases: ["aarch64-unknown-linux-musl", "linux-arm64-musl"]},
  {name: "x86_64-apple-darwin", aliases: ["x86_64-apple-darwin", "darwin-x64"]},
  {name: "x86_64-unknown-linux-gnu", aliases: ["x86_64-unknown-linux-gnu", "linux-x64-gnu"]},
  {name: "x86_64-unknown-linux-musl", aliases: ["x86_64-unknown-linux-musl", "linux-x64-musl"]},
];

const knownMissingTargets = new Set([
  "@chainsafe/hashtree@1.0.2:x86_64-apple-darwin",
  "@crate-crypto/node-eth-kzg@0.9.1:aarch64-unknown-linux-musl",
  "@crate-crypto/node-eth-kzg@0.9.1:x86_64-unknown-linux-musl",
  "classic-level@1.4.1:aarch64-unknown-linux-musl",
  "classic-level@3.0.0:aarch64-unknown-linux-musl",
]);

const vexInstructionPattern =
  /\b(vmov|vadd|vsub|vmul|vdiv|vxor|vpxor|vpand|vpor|vpcmp|vshuf|vperm|vbroadcast|vinsert|vextract|vzero|vfmadd|vfmsub|vfnmadd|vfnmsub|vcvt|vpack|vpunpck|vpalign|vblend|vround|vtest|vptest)[a-z]*\b/;

function resolveManifest(fromDir, packageName) {
  let currentDir = fromDir;
  const packageSegments = packageName.split("/");

  while (true) {
    const candidate = path.join(currentDir, "node_modules", ...packageSegments, "package.json");
    if (fs.existsSync(candidate)) {
      return fs.realpathSync(candidate);
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function findNodeFiles(dir, baseDir = dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findNodeFiles(entryPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".node")) {
      files.push(path.relative(baseDir, entryPath).split(path.sep).join("/"));
    }
  }
  return files;
}

function collectLinuxX64GnuBinaries(dir, binaryFiles) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLinuxX64GnuBinaries(entryPath, binaryFiles);
    } else if (entry.isFile() && entry.name.endsWith(".node")) {
      const normalizedPath = entryPath.split(path.sep).join("/");
      const isBundledPrebuild = normalizedPath.includes("/prebuilds/");
      const isLinuxX64GnuPrebuild = normalizedPath.includes("/prebuilds/linux-x64/") && !entry.name.includes("musl");
      const isTargetPackage = /(?:linux-x64-gnu|x86_64-unknown-linux-gnu)/.test(normalizedPath);
      const isOtherTargetPackage =
        /(?:darwin|win32|windows|linux-(?:arm64|aarch64)|aarch64-(?:apple|unknown)|linux-x64-musl|x86_64-unknown-linux-musl)/.test(
          normalizedPath
        );

      if (isLinuxX64GnuPrebuild || isTargetPackage || (!isBundledPrebuild && !isOtherTargetPackage)) {
        binaryFiles.add(fs.realpathSync(entryPath));
      }
    }
  }
}

function optionalDependencyForTarget(optionalDependencies, target) {
  return Object.entries(optionalDependencies).find(([name]) =>
    target.aliases.some((alias) => name.endsWith(`-${alias}`))
  );
}

function hasBundledPrebuild(prebuildFiles, targetName) {
  switch (targetName) {
    case "aarch64-apple-darwin":
      return prebuildFiles.some((file) => file.startsWith("darwin-arm64/") || file.startsWith("darwin-x64+arm64/"));
    case "aarch64-unknown-linux-gnu":
      return prebuildFiles.some((file) => file.startsWith("linux-arm64/") && !file.includes("musl"));
    case "aarch64-unknown-linux-musl":
      return prebuildFiles.some((file) => file.startsWith("linux-arm64/") && file.includes("musl"));
    case "x86_64-apple-darwin":
      return prebuildFiles.some((file) => file.startsWith("darwin-x64/") || file.startsWith("darwin-x64+arm64/"));
    case "x86_64-unknown-linux-gnu":
      return prebuildFiles.some((file) => file.startsWith("linux-x64/") && !file.includes("musl"));
    case "x86_64-unknown-linux-musl":
      return prebuildFiles.some((file) => file.startsWith("linux-x64/") && file.includes("musl"));
    default:
      return false;
  }
}

function hasZapiTarget(zapiTargets, target) {
  return zapiTargets.some((zapiTarget) => target.aliases.includes(zapiTarget));
}

function validateNativePackageTargets(manifest, prebuildFiles) {
  const optionalDependencies = manifest.optionalDependencies ?? {};
  const hasTargetPackages = Object.keys(optionalDependencies).some((name) =>
    requiredTargets.some((target) => target.aliases.some((alias) => name.endsWith(`-${alias}`)))
  );
  // zapi packages can declare their build matrix before exposing target
  // packages or bundled prebuilds, so use it only as a fallback.
  const zapiTargets = Array.isArray(manifest.zapi?.targets) ? manifest.zapi.targets : [];
  const isNativePackage = hasTargetPackages || prebuildFiles.length > 0 || zapiTargets.length > 0;
  const errors = [];

  if (!isNativePackage) {
    return {isNativePackage, errors};
  }

  for (const target of requiredTargets) {
    if (hasTargetPackages) {
      const targetDependency = optionalDependencyForTarget(optionalDependencies, target);
      if (targetDependency === undefined) {
        errors.push({target: target.name, message: `missing optional dependency for ${target.name}`});
      } else if (targetDependency[1] !== manifest.version) {
        errors.push({
          target: target.name,
          message: `optional dependency ${targetDependency[0]}@${targetDependency[1]} does not match ${manifest.name}@${manifest.version}`,
        });
      }
    } else if (prebuildFiles.length > 0) {
      if (!hasBundledPrebuild(prebuildFiles, target.name)) {
        errors.push({target: target.name, message: `missing bundled prebuild for ${target.name}`});
      }
    } else if (!hasZapiTarget(zapiTargets, target)) {
      errors.push({target: target.name, message: `missing zapi target for ${target.name}`});
    }
  }

  return {isNativePackage, errors};
}

function checkNativeTargetCoverage() {
  const visited = new Set();
  const binaryFiles = new Set();
  let errorCount = 0;
  let nativePackageCount = 0;

  function visitManifest(manifestPath) {
    const realManifestPath = fs.realpathSync(manifestPath);
    if (visited.has(realManifestPath)) {
      return;
    }
    visited.add(realManifestPath);

    const manifest = JSON.parse(fs.readFileSync(realManifestPath, "utf8"));
    const manifestDir = path.dirname(realManifestPath);
    const dependencies = manifest.dependencies ?? {};
    const optionalDependencies = manifest.optionalDependencies ?? {};
    const prebuildFiles = findNodeFiles(path.join(manifestDir, "prebuilds"));
    collectLinuxX64GnuBinaries(manifestDir, binaryFiles);

    const validation = validateNativePackageTargets(manifest, prebuildFiles);
    if (validation.isNativePackage) {
      nativePackageCount++;
      const knownPackageGaps = [];
      const packageErrors = [];

      for (const error of validation.errors) {
        const missingTargetKey = `${manifest.name}@${manifest.version}:${error.target}`;
        if (knownMissingTargets.has(missingTargetKey)) {
          knownPackageGaps.push(error.message);
        } else {
          packageErrors.push(error.message);
        }
      }

      if (packageErrors.length === 0) {
        if (knownPackageGaps.length === 0) {
          console.log(`OK:   ${manifest.name}@${manifest.version}`);
        } else {
          console.log(`WARN: ${manifest.name}@${manifest.version} has known target gaps`);
          for (const error of knownPackageGaps) {
            console.log(`   ${error}`);
          }
        }
      } else {
        console.log(`FAIL: ${manifest.name}@${manifest.version}`);
        for (const error of knownPackageGaps) {
          console.log(`   known: ${error}`);
        }
        for (const error of packageErrors) {
          console.log(`   ${error}`);
        }
        errorCount += packageErrors.length;
      }
    }

    for (const dependencyName of Object.keys(dependencies)) {
      const dependencyManifest = resolveManifest(manifestDir, dependencyName);
      if (dependencyManifest === null) {
        console.log(`FAIL: ${manifest.name}@${manifest.version}: dependency ${dependencyName} is not installed`);
        errorCount++;
      } else {
        visitManifest(dependencyManifest);
      }
    }

    // Optional dependencies are part of the production graph, but packages for
    // other platforms are expected to be absent from the current installation.
    for (const dependencyName of Object.keys(optionalDependencies)) {
      const dependencyManifest = resolveManifest(manifestDir, dependencyName);
      if (dependencyManifest !== null) {
        visitManifest(dependencyManifest);
      }
    }
  }

  for (const manifestPath of rootManifests) {
    const absoluteManifestPath = path.join(repoRoot, manifestPath);
    if (!fs.existsSync(absoluteManifestPath)) {
      console.log(`FAIL: root package manifest ${manifestPath} is missing`);
      errorCount++;
    } else {
      visitManifest(absoluteManifestPath);
    }
  }

  if (nativePackageCount === 0) {
    console.log("FAIL: no native packages found in the beacon-node or validator production dependency graphs");
    errorCount++;
  }

  return {success: errorCount === 0, binaryFiles: [...binaryFiles].sort()};
}

function countMatchingLines(disassembly, pattern) {
  return disassembly.split("\n").reduce((count, line) => count + (pattern.test(line) ? 1 : 0), 0);
}

function analyzeDisassembly(disassembly) {
  const ymmCount = countMatchingLines(disassembly, /ymm/);
  const vexCount = countMatchingLines(disassembly, vexInstructionPattern);
  const cpuidCount = countMatchingLines(disassembly, /cpuid/);

  return {ymmCount, vexCount, avxCount: ymmCount + vexCount, cpuidCount};
}

function getBinaryName(binaryFile) {
  const normalizedPath = binaryFile.split(path.sep).join("/");
  const nodeModulesMarker = "/node_modules/";
  const nodeModulesIndex = normalizedPath.lastIndexOf(nodeModulesMarker);
  const relativePath =
    nodeModulesIndex === -1 ? normalizedPath : normalizedPath.slice(nodeModulesIndex + nodeModulesMarker.length);

  return relativePath.replace(/\/[^/]*\.node$/, "");
}

function disassemble(binaryFile) {
  const result = spawnSync("objdump", ["-d", binaryFile], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });

  if (result.error !== undefined) {
    return {disassembly: "", error: result.error.message};
  }
  if (result.status !== 0) {
    return {disassembly: "", error: result.stderr.trim() || `objdump exited with status ${result.status}`};
  }

  return {disassembly: result.stdout, error: null};
}

function checkCpuPortability(binaryFiles, disassembleBinary = disassemble) {
  if (binaryFiles.length === 0) {
    console.log("No linux-x64 native modules found (skipped).");
    return {success: true, found: false};
  }

  let success = true;
  for (const binaryFile of binaryFiles) {
    const name = getBinaryName(binaryFile);
    const result = disassembleBinary(binaryFile);
    if (result.error !== null) {
      console.log(`FAIL: ${name}`);
      console.log(`   Unable to disassemble binary: ${result.error}`);
      success = false;
      continue;
    }

    const {ymmCount, vexCount, avxCount, cpuidCount} = analyzeDisassembly(result.disassembly);
    if (avxCount > 0 && cpuidCount === 0) {
      console.log(`FAIL: ${name}`);
      console.log(`   ${avxCount} AVX instructions (${ymmCount} ymm, ${vexCount} vex-encoded), 0 CPUID dispatch calls`);
      console.log("   Binary will crash with SIGILL on CPUs without AVX (e.g. Celeron N5105)");
      success = false;
    } else if (avxCount > 0) {
      console.log(`OK:   ${name} (${avxCount} AVX insns, ${cpuidCount} CPUID calls)`);
    } else {
      console.log(`OK:   ${name} (no AVX)`);
    }
  }

  return {success, found: true};
}

function hasObjdump() {
  const result = spawnSync("objdump", ["--version"], {encoding: "utf8"});
  if (result.error?.code === "ENOENT") {
    return false;
  }
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw Error(result.stderr.trim() || `objdump --version exited with status ${result.status}`);
  }
  return true;
}

function main() {
  console.log("Checking native package target coverage...");
  console.log("");

  const targetCoverage = checkNativeTargetCoverage();
  console.log("");

  let cpuPortabilitySuccess = true;
  if (!hasObjdump()) {
    console.log("warning: objdump not found, skipping CPU portability check.");
  } else {
    console.log("Checking native modules for CPU portability...");
    console.log("");

    const cpuPortability = checkCpuPortability(targetCoverage.binaryFiles);
    cpuPortabilitySuccess = cpuPortability.success;

    if (cpuPortability.found) {
      console.log("");
      if (cpuPortability.success) {
        console.log("All native modules have proper CPU feature detection");
      } else {
        console.log("");
        console.log("Some native modules use AVX without runtime CPU detection.");
        console.log("These will crash with SIGILL (exit code 132) on CPUs without AVX support.");
        console.log("See: https://github.com/ChainSafe/lodestar/issues/9042");
      }
    }
  }

  const success = targetCoverage.success && cpuPortabilitySuccess;
  if (!success) {
    console.log("");
    console.log("Native portability checks failed.");
  }

  process.exitCode = success ? 0 : 1;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`FAIL: Native portability check crashed\n${message}`);
    process.exitCode = 1;
  }
}
