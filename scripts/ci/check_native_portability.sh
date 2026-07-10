#!/usr/bin/env bash
# check_native_portability.sh
#
# Checks native package target coverage and scans prebuilt native (.node)
# binaries for unconditional AVX/AVX2 usage. Native modules that use AVX
# instructions MUST have CPUID-based runtime dispatch to fall back on CPUs
# without AVX support (e.g. Intel Atom/Celeron).
#
# Catches issues like https://github.com/ChainSafe/lodestar/issues/9042
# where a dependency was compiled with hard-coded -C target-feature=+avx2.

set -euo pipefail

EXIT_CODE=0

echo "Checking native package target coverage..."
echo ""

# Keep this in sync with Lodestar's supported x64 and ARM64 native platforms.
required_native_targets=(
  "aarch64-apple-darwin"
  "aarch64-unknown-linux-gnu"
  "aarch64-unknown-linux-musl"
  "x86_64-apple-darwin"
  "x86_64-unknown-linux-gnu"
  "x86_64-unknown-linux-musl"
)

lodestar_z_pkg="node_modules/@chainsafe/lodestar-z/package.json"
if [ -f "$lodestar_z_pkg" ]; then
  if matrix_errors=$(node --input-type=commonjs - "$lodestar_z_pkg" "${required_native_targets[@]}" 2>&1 <<'NODE'
const fs = require("node:fs");

const [manifestPath, ...requiredTargets] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const configuredTargets = new Set(manifest.zapi?.targets ?? []);
const optionalDependencies = manifest.optionalDependencies ?? {};
const errors = [];

for (const target of requiredTargets) {
  if (!configuredTargets.has(target)) {
    errors.push(`missing zapi target ${target}`);
  }

  const targetPackage = `${manifest.name}-${target}`;
  if (optionalDependencies[targetPackage] !== manifest.version) {
    errors.push(`missing optional dependency ${targetPackage}@${manifest.version}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`   ${error}`);
  }
  process.exit(1);
}
NODE
  ); then
    echo "OK:   @chainsafe/lodestar-z declares the complete supported native target matrix"
  else
    echo "FAIL: @chainsafe/lodestar-z has an incomplete supported native target matrix"
    echo "$matrix_errors"
    EXIT_CODE=1
  fi
else
  if [ "${CI:-}" = "true" ]; then
    echo "FAIL: @chainsafe/lodestar-z is not installed"
    EXIT_CODE=1
  else
    echo "SKIP: @chainsafe/lodestar-z is not installed"
  fi
fi

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
done < <(find node_modules -name "*.node" -path "*linux-x64*" ! -path "*/rollup/*" ! -path "*/swc/*" ! -path "*musl*" 2>/dev/null | sort)

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
