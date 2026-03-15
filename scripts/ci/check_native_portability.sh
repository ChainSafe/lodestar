#!/usr/bin/env bash
# check_native_portability.sh
#
# Scans prebuilt native (.node) binaries for unconditional AVX/AVX2 usage.
# Native modules that use AVX instructions MUST have CPUID-based runtime
# dispatch to fall back on CPUs without AVX support (e.g. Intel Atom/Celeron).
#
# Catches issues like https://github.com/ChainSafe/lodestar/issues/9042
# where a dependency was compiled with hard-coded -C target-feature=+avx2.
#
# Known issues can be tracked via KNOWN_PORTABILITY_ISSUES below. These
# produce a warning instead of a failure, so the check passes while the
# upstream fix is pending.

set -euo pipefail

# ---------------------------------------------------------------------------
# Known portability issues (package name prefix → tracking issue URL)
#
# Packages listed here will be reported as WARN instead of FAIL.
# Remove entries once the upstream dependency ships a fixed version.
# ---------------------------------------------------------------------------
declare -A KNOWN_PORTABILITY_ISSUES=(
  ["@vekexasia/bigint-buffer2"]="https://github.com/nicolo-ribaudo/bigint-buffer/issues/1"
)

if ! command -v objdump > /dev/null 2>&1; then
  echo "warning: objdump not found, skipping CPU portability check."
  exit 0
fi

EXIT_CODE=0

echo "Checking native modules for CPU portability..."
echo ""

found=0
warn_count=0
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
    # Check if this is a known issue
    known_issue=""
    for pkg in "${!KNOWN_PORTABILITY_ISSUES[@]}"; do
      if [[ "$name" == "$pkg"* ]]; then
        known_issue="${KNOWN_PORTABILITY_ISSUES[$pkg]}"
        break
      fi
    done

    if [ -n "$known_issue" ]; then
      echo "WARN: $name (known issue)"
      echo "   $avx_count AVX instructions ($ymm_count ymm, $vex_count vex-encoded), 0 CPUID dispatch calls"
      echo "   Tracking: $known_issue"
      warn_count=$((warn_count + 1))
    else
      echo "FAIL: $name"
      echo "   $avx_count AVX instructions ($ymm_count ymm, $vex_count vex-encoded), 0 CPUID dispatch calls"
      echo "   Binary will crash with SIGILL on CPUs without AVX (e.g. Celeron N5105)"
      EXIT_CODE=1
    fi
  elif [ "$avx_count" -gt 0 ]; then
    echo "OK:   $name ($avx_count AVX insns, $cpuid_count CPUID calls)"
  else
    echo "OK:   $name (no AVX)"
  fi
done < <(find node_modules -name "*.node" -path "*linux-x64*" ! -path "*/rollup/*" ! -path "*/swc/*" ! -path "*musl*" 2>/dev/null | sort)

if [ "$found" -eq 0 ]; then
  echo "No linux-x64 native modules found (skipped)."
  exit 0
fi

echo ""
if [ "$EXIT_CODE" -eq 0 ] && [ "$warn_count" -eq 0 ]; then
  echo "All native modules have proper CPU feature detection"
elif [ "$EXIT_CODE" -eq 0 ] && [ "$warn_count" -gt 0 ]; then
  echo "$warn_count known portability issue(s) (tracked upstream, not blocking)."
  echo "All other native modules have proper CPU feature detection."
else
  echo ""
  echo "Some native modules use AVX without runtime CPU detection."
  echo "These will crash with SIGILL (exit code 132) on CPUs without AVX support."
  echo "See: https://github.com/ChainSafe/lodestar/issues/9042"
fi

exit $EXIT_CODE
