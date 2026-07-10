#!/usr/bin/env bash
# check_native_portability.sh
#
# Checks native package target coverage in the beacon-node and validator
# production dependency graphs, then scans their native (.node) binaries for
# unconditional AVX/AVX2 usage. Native modules that use AVX instructions MUST
# have CPUID-based runtime dispatch to fall back on CPUs without AVX support
# (e.g. Intel Atom/Celeron).
#
# Catches issues like https://github.com/ChainSafe/lodestar/issues/9042
# where a dependency was compiled with hard-coded -C target-feature=+avx2.

set -euo pipefail

EXIT_CODE=0

echo "Checking native package target coverage..."
echo ""

if ! matrix_output=$(node --input-type=commonjs 2>&1 <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

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

const visited = new Set();
const binaryFiles = new Set();
const errors = [];
let nativePackageCount = 0;

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

function collectLinuxX64GnuBinaries(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLinuxX64GnuBinaries(entryPath);
    } else if (entry.isFile() && entry.name.endsWith(".node")) {
      const normalizedPath = entryPath.split(path.sep).join("/");
      const isBundledPrebuild = normalizedPath.includes("/prebuilds/");
      const isLinuxX64GnuPrebuild = normalizedPath.includes("/prebuilds/linux-x64/") && !entry.name.includes("musl");
      const isTargetPackage = /(?:linux-x64-gnu|x86_64-unknown-linux-gnu)/.test(normalizedPath);
      const isOtherTargetPackage = /(?:darwin|win32|linux-arm|linux-x64-musl|unknown-linux-musl)/.test(normalizedPath);

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
  collectLinuxX64GnuBinaries(manifestDir);
  const hasTargetPackages = Object.keys(optionalDependencies).some((name) =>
    requiredTargets.some((target) => target.aliases.some((alias) => name.endsWith(`-${alias}`)))
  );

  if (hasTargetPackages || prebuildFiles.length > 0) {
    nativePackageCount++;
    const packageErrors = [];
    const knownPackageGaps = [];

    for (const target of requiredTargets) {
      let error = null;
      if (hasTargetPackages) {
        if (!optionalDependencyForTarget(optionalDependencies, target)) {
          error = `missing optional dependency for ${target.name}`;
        }
      } else if (!hasBundledPrebuild(prebuildFiles, target.name)) {
        error = `missing bundled prebuild for ${target.name}`;
      }

      if (error !== null) {
        const missingTargetKey = `${manifest.name}@${manifest.version}:${target.name}`;
        if (knownMissingTargets.has(missingTargetKey)) {
          knownPackageGaps.push(error);
        } else {
          packageErrors.push(error);
        }
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
      errors.push(...packageErrors);
    }
  }

  for (const dependencyName of Object.keys(dependencies)) {
    const dependencyManifest = resolveManifest(manifestDir, dependencyName);
    if (dependencyManifest === null) {
      errors.push(`${manifest.name}: dependency ${dependencyName} is not installed`);
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
  if (!fs.existsSync(manifestPath)) {
    errors.push(`root package manifest ${manifestPath} is missing`);
  } else {
    visitManifest(manifestPath);
  }
}

if (nativePackageCount === 0) {
  errors.push("no native packages found in the beacon-node or validator production dependency graphs");
}

if (errors.length > 0) {
  process.exitCode = 1;
}

for (const binaryFile of binaryFiles) {
  console.log(`BINARY\t${binaryFile}`);
}
NODE
); then
  EXIT_CODE=1
fi
binary_files=$(echo "$matrix_output" | sed -n $'s/^BINARY\t//p')
matrix_output=$(echo "$matrix_output" | sed $'/^BINARY\t/d')
echo "$matrix_output"

echo ""

if ! command -v objdump > /dev/null 2>&1; then
  echo "warning: objdump not found, skipping CPU portability check."
  exit "$EXIT_CODE"
fi

CPU_EXIT_CODE=0

echo "Checking native modules for CPU portability..."
echo ""

found=0
while IFS= read -r node_file; do
  found=1
  # Relative path from node_modules for readable output
  name=$(echo "$node_file" | sed 's|.*node_modules/||;s|/[^/]*\.node$||')

  # Disassemble once, then grep for AVX indicators and CPUID calls
  dump=$(objdump -d "$node_file" 2>/dev/null || true)

  # Count 256-bit AVX (YMM registers)
  ymm_count=$(echo "$dump" | grep -c "ymm" || true)
  # Count VEX-encoded instructions (v-prefixed SIMD mnemonics like vmovaps, vzeroupper)
  # These also require AVX support and will SIGILL on non-AVX CPUs
  vex_count=$(echo "$dump" | grep -cE "\b(vmov|vadd|vsub|vmul|vdiv|vxor|vpxor|vpand|vpor|vpcmp|vshuf|vperm|vbroadcast|vinsert|vextract|vzero|vfmadd|vfmsub|vfnmadd|vfnmsub|vcvt|vpack|vpunpck|vpalign|vblend|vround|vtest|vptest)[a-z]*\b" || true)
  avx_count=$((ymm_count + vex_count))
  # Count CPUID calls (runtime CPU feature detection)
  cpuid_count=$(echo "$dump" | grep -c "cpuid" || true)

  if [ "$avx_count" -gt 0 ] && [ "$cpuid_count" -eq 0 ]; then
    echo "FAIL: $name"
    echo "   $avx_count AVX instructions ($ymm_count ymm, $vex_count vex-encoded), 0 CPUID dispatch calls"
    echo "   Binary will crash with SIGILL on CPUs without AVX (e.g. Celeron N5105)"
    CPU_EXIT_CODE=1
    EXIT_CODE=1
  elif [ "$avx_count" -gt 0 ]; then
    echo "OK:   $name ($avx_count AVX insns, $cpuid_count CPUID calls)"
  else
    echo "OK:   $name (no AVX)"
  fi
done <<< "$binary_files"

if [ "$found" -eq 0 ]; then
  echo "No linux-x64 native modules found (skipped)."
  exit "$EXIT_CODE"
fi

echo ""
if [ "$CPU_EXIT_CODE" -eq 0 ]; then
  echo "All native modules have proper CPU feature detection"
else
  echo ""
  echo "Some native modules use AVX without runtime CPU detection."
  echo "These will crash with SIGILL (exit code 132) on CPUs without AVX support."
  echo "See: https://github.com/ChainSafe/lodestar/issues/9042"
fi

if [ "$EXIT_CODE" -ne 0 ]; then
  echo ""
  echo "Native portability checks failed."
fi

exit $EXIT_CODE
