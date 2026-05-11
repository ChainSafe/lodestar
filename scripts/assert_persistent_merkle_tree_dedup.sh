#!/bin/bash
#
# Assert @chainsafe/persistent-merkle-tree resolves to a single 1.x instance in pnpm-lock.yaml.
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
MAJOR="1"

matches=$(grep -oE "'${PACKAGE}@${MAJOR}\.[0-9]+\.[0-9]+'" "$LOCKFILE" | sort -u)
count=$(echo -n "$matches" | grep -c '^' || true)

if [ "$count" -gt 1 ]; then
  echo "ERROR: found multiple ${MAJOR}.x versions of ${PACKAGE} in ${LOCKFILE}:"
  echo "$matches" | sed 's/^/  /'
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

echo "OK: single ${MAJOR}.x copy of ${PACKAGE} in ${LOCKFILE}"
