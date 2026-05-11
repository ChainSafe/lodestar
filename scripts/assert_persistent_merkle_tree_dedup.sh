#!/bin/bash
#
# Assert @chainsafe/persistent-merkle-tree resolves to a single instance in pnpm-lock.yaml.
#
# persistent-merkle-tree carries a module-scoped `hasher` binding configured by Lodestar at
# startup via setHasher(hashtree). If a second copy is loaded transitively (e.g. under
# @chainsafe/ssz when its package.json declares an empty version constraint), Lodestar's
# setHasher call configures only one copy while ssz internals digest through the other —
# silently falling back to the slow JS noble hasher and producing a significant GC regression
# on mainnet (see PR #9211).

set -euo pipefail

LOCKFILE="${1:-pnpm-lock.yaml}"
PACKAGE="@chainsafe/persistent-merkle-tree"

# Versions known to come from non-runtime legacy paths and excluded from the dedup check.
# @ethereumjs/util pulls in @chainsafe/ssz@0.11.1 which depends on persistent-merkle-tree@0.6.1.
# That predates the setHasher API and can't share a singleton with the modern 1.x line.
EXEMPT_VERSIONS=("0.6.1")

# Extract every resolved version of PACKAGE that appears as a lockfile key.
# pnpm-lock.yaml keys are of the form '<name>@<version>'[(<peer-dep-suffix>)]':' — version may
# include pre-release tags (e.g. 1.2.5-alpha.0) and a parenthesized peer-dep suffix.
# - grep captures everything between '<name>@' and the next ' or :
# - sed strips any '(...)' peer-dep suffix to normalize on the bare version
exempt_filter=$(printf '%s\n' "${EXEMPT_VERSIONS[@]}")
versions=$(
  grep -oE "'${PACKAGE}@[^':]+" "$LOCKFILE" \
    | sed "s|'${PACKAGE}@||" \
    | sed -E 's|\(.+$||' \
    | grep -vxF "$exempt_filter" \
    | sort -u
)
count=$(echo -n "$versions" | grep -c '^' || true)

if [ "$count" -eq 0 ]; then
  echo "ERROR: ${PACKAGE} not found in ${LOCKFILE}."
  echo "The lockfile layout may have changed or the dependency is gone. Update this script"
  echo "to match, or delete it if ${PACKAGE} is no longer used."
  exit 1
fi

if [ "$count" -gt 1 ]; then
  echo "ERROR: found multiple versions of ${PACKAGE} in ${LOCKFILE}:"
  echo "$versions" | sed 's/^/  /'
  echo
  echo "Multiple instances split the module-scoped hasher singleton — Lodestar's"
  echo "setHasher(hashtree) call configures only one copy, while @chainsafe/ssz internals"
  echo "digest via the other (silently falling back to the slow JS noble hasher). Result:"
  echo "significant GC regression on mainnet."
  echo
  echo "Fix: align every workspace package.json pin for ${PACKAGE} with the highest version"
  echo "present, then run 'pnpm install' to dedupe."
  exit 1
fi

echo "OK: single copy of ${PACKAGE}@${versions} in ${LOCKFILE}"
