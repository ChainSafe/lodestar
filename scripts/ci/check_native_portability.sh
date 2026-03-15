#!/usr/bin/env bash
# check_native_portability.sh
#
# Scans prebuilt native (.node) binaries for unconditional AVX/AVX2 usage.
# Native modules that use AVX instructions MUST have CPUID-based runtime
# dispatch to fall back on CPUs without AVX support (e.g. Intel Atom/Celeron).
#
# Catches issues like https://github.com/ChainSafe/lodestar/issues/9042
# where a dependency was compiled with hard-coded -C target-feature=+avx2.

set -euo pipefail

EXIT_CODE=0

echo "Checking native modules for CPU portability..."
echo ""

found=0
while IFS= read -r node_file; do
  found=1
  # Relative path from node_modules for readable output
  name=$(echo "$node_file" | sed 's|.*node_modules/||;s|/[^/]*\.node$||')

  # Count AVX instructions (YMM register = 256-bit AVX)
  ymm_count=$(objdump -d "$node_file" 2>/dev/null | grep -c "ymm" || true)

  # Count CPUID calls (runtime CPU feature detection)
  cpuid_count=$(objdump -d "$node_file" 2>/dev/null | grep -c "cpuid" || true)

  if [ "$ymm_count" -gt 0 ] && [ "$cpuid_count" -eq 0 ]; then
    echo "FAIL: $name"
    echo "   $ymm_count AVX instructions, 0 CPUID dispatch calls"
    echo "   Binary will crash with SIGILL on CPUs without AVX (e.g. Celeron N5105)"
    EXIT_CODE=1
  elif [ "$ymm_count" -gt 0 ]; then
    echo "OK:   $name ($ymm_count AVX insns, $cpuid_count CPUID calls)"
  else
    echo "OK:   $name (no AVX)"
  fi
done < <(find node_modules -name "*.node" -path "*linux-x64*" ! -path "*/rollup/*" ! -path "*/swc/*" ! -path "*musl*" 2>/dev/null | sort)

if [ "$found" -eq 0 ]; then
  echo "No linux-x64 native modules found (skipped)."
  exit 0
fi

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "All native modules have proper CPU feature detection"
else
  echo ""
  echo "Some native modules use AVX without runtime CPU detection."
  echo "These will crash with SIGILL (exit code 132) on CPUs without AVX support."
  echo "See: https://github.com/ChainSafe/lodestar/issues/9042"
fi

exit $EXIT_CODE
