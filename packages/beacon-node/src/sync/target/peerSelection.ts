import {ColumnIndex} from "@lodestar/types";
import {PeerIdStr} from "../../util/peerId.js";
import {QuotaKind, QuotaLedger} from "./quotaLedger.js";

// ---------------------------------------------------------------------------
// Balancer-shaped peer selection for TargetSync requests.
//
// Preference order: advocates (peers that claimed the chain we're syncing)
// before the general connected set; within a group, least-active (fewest
// in-flight requests) with a shuffled tie-break so load spreads and a
// deterministic first pick can't be farmed. Selection and quota reservation
// are ATOMIC: the returned peer already holds the reservation (no TOCTOU
// between "peer is eligible" and "charge its window").
// ---------------------------------------------------------------------------

export type SelectPeerOpts = {
  kind: QuotaKind;
  /** Units to reserve (blocks / sidecars / roots) on the selected peer. */
  units: number;
  ledger: QuotaLedger;
  /** Currently connected peers (the network layer owns liveness). */
  connected: Iterable<PeerIdStr>;
  /** Peers that advocated this chain — preferred providers. */
  advocates?: ReadonlySet<PeerIdStr> | ReadonlyMap<PeerIdStr, unknown>;
  /** Peers already tried-and-failed for this attempt (per-target exclusion). */
  exclude?: ReadonlySet<PeerIdStr>;
  /**
   * Column-custody constraint: only peers whose advertised custody OVERLAPS
   * this set qualify (partial fills accumulate across peers — never require a
   * single all-remaining custodian; that predicate wedges under real PeerDAS
   * custody distributions).
   */
  custodyOverlapOf?: ColumnIndex[];
  /** Advertised custody for a peer; null/undefined = unknown (fails the custody constraint). */
  getCustodyColumns?: (peer: PeerIdStr) => ColumnIndex[] | null | undefined;
};

/**
 * Pick the best eligible peer and reserve quota on it in one step.
 * Returns `null` when no connected peer can take the request right now —
 * the caller parks (`peerStarved`) and retries on the ledger's advice.
 */
export function selectAndReservePeer(opts: SelectPeerOpts): PeerIdStr | null {
  const {kind, units, ledger, exclude, advocates, custodyOverlapOf, getCustodyColumns} = opts;

  const eligible: PeerIdStr[] = [];
  for (const peer of opts.connected) {
    if (exclude?.has(peer)) continue;
    if (custodyOverlapOf !== undefined && custodyOverlapOf.length > 0) {
      const custody = getCustodyColumns?.(peer);
      if (custody == null) continue;
      const custodySet = new Set(custody);
      if (!custodyOverlapOf.some((c) => custodySet.has(c))) continue;
    }
    eligible.push(peer);
  }
  if (eligible.length === 0) return null;

  const isAdvocate = (peer: PeerIdStr): boolean => advocates?.has(peer) ?? false;
  const groups: PeerIdStr[][] = [eligible.filter(isAdvocate), eligible.filter((p) => !isAdvocate(p))];

  for (const group of groups) {
    // Shuffle first, then stable-sort by in-flight count: least-active wins,
    // shuffled order breaks ties.
    shuffleInPlace(group);
    group.sort((a, b) => ledger.inFlightTotal(a) - ledger.inFlightTotal(b));
    for (const peer of group) {
      // tryReserve enforces parking, spacing, in-flight caps, and window budget.
      if (ledger.tryReserve(peer, kind, units)) return peer;
    }
  }

  return null;
}

/** Earliest time ANY of the given peers could take the request (for park deadlines). */
export function earliestAvailableMs(
  ledger: QuotaLedger,
  peers: Iterable<PeerIdStr>,
  kind: QuotaKind,
  units: number
): number {
  let earliest = Number.POSITIVE_INFINITY;
  for (const peer of peers) {
    const at = ledger.nextAvailableMs(peer, kind, units);
    if (at === 0) return 0;
    earliest = Math.min(earliest, at);
  }
  return Number.isFinite(earliest) ? earliest : 0;
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
