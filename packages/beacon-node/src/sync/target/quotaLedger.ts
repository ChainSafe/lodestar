import {RootHex} from "@lodestar/types";
import {PeerIdStr} from "../../util/peerId.js";

// ---------------------------------------------------------------------------
// QuotaLedger — outbound per-peer spend tracking.
//
// Honest remotes enforce inbound reqresp quotas and apply PeerAction.Fatal to
// a peer that breaches them (ReqRespBeaconNode onRateLimit → "rate_limit_rpc").
// Nothing else in the process tracks OUR outbound spend, so without this
// ledger a serial walk (128-block by-head hops back-to-back at one peer) gets
// the node banned by its own honest peers. Policy per dossier §2.8 + [A11]:
//
//  - ByHead: at most ONE in-flight per peer and ≥15 s spacing between
//    successive requests to the same peer, at the full 128-block count. Two
//    requests ≥15 s apart can never coexist in any remote 10 s sliding window
//    regardless of clock alignment, so the remote's quota is provably never
//    breached while full-size hops are preserved.
//  - ByRoot protocols (blocks / columns / envelopes): a 50%-of-remote-quota
//    sliding window, leaving headroom for the process's other consumers
//    (gossip fetches, backfill, API) that share the same remote quotas.
//  - ≤2 in-flight per (peer, protocol) (ByHead: ≤1).
//  - Peers that rate-limit us are parked until their window has provably reset.
// ---------------------------------------------------------------------------

export type QuotaKind = "byHead" | "blocksByRoot" | "columnsByRoot" | "envelopesByRoot";

export type QuotaLimit = {
  /** Max units (blocks/sidecars/roots) charged to one peer within `windowMs`. */
  maxUnits: number;
  windowMs: number;
  /** Max concurrent in-flight requests to one peer for this protocol. */
  maxInFlight: number;
  /** Minimum spacing between successive requests to the same peer (0 = none). */
  minSpacingMs: number;
};

export type QuotaLimits = Record<QuotaKind, QuotaLimit>;

/** ByHead spacing rule [A11]: provably non-breaching for a 10 s remote window under any alignment. */
export const BY_HEAD_MIN_SPACING_MS = 15_000;
/** Remote quota windows are 10 s (rateLimit.ts); mirror it. */
const REMOTE_WINDOW_MS = 10_000;
/** How long to exclude a peer that rate-limited us: one full remote window + slack. */
export const RATE_LIMITED_PARK_MS = 15_000;

/**
 * Derive the ledger limits from the same config constants that parameterize the
 * REMOTE inbound quotas (network/reqresp/rateLimit.ts) — the two tables must
 * move together, which the unit tests cross-check.
 */
export function defaultQuotaLimits(config: {
  MAX_REQUEST_BLOCKS_DENEB: number;
  MAX_REQUEST_DATA_COLUMN_SIDECARS: number;
  MAX_REQUEST_PAYLOADS: number;
}): QuotaLimits {
  return {
    // [A11] Full hop size; safety comes from spacing + one-in-flight, not halving.
    byHead: {
      maxUnits: config.MAX_REQUEST_BLOCKS_DENEB,
      windowMs: REMOTE_WINDOW_MS,
      maxInFlight: 1,
      minSpacingMs: BY_HEAD_MIN_SPACING_MS,
    },
    blocksByRoot: {
      maxUnits: Math.floor(config.MAX_REQUEST_BLOCKS_DENEB / 2),
      windowMs: REMOTE_WINDOW_MS,
      maxInFlight: 2,
      minSpacingMs: 0,
    },
    columnsByRoot: {
      maxUnits: Math.floor(config.MAX_REQUEST_DATA_COLUMN_SIDECARS / 2),
      windowMs: REMOTE_WINDOW_MS,
      maxInFlight: 2,
      minSpacingMs: 0,
    },
    envelopesByRoot: {
      maxUnits: Math.floor(config.MAX_REQUEST_PAYLOADS / 2),
      windowMs: REMOTE_WINDOW_MS,
      maxInFlight: 2,
      minSpacingMs: 0,
    },
  };
}

type PeerKindState = {
  /** Granted charges within the current window: [atMs, units]. */
  charges: {atMs: number; units: number}[];
  inFlight: number;
  /** Time of the last grant; null = never granted (0 is a valid grant time). */
  lastGrantMs: number | null;
};

export class QuotaLedger {
  private readonly state = new Map<PeerIdStr, Map<QuotaKind, PeerKindState>>();
  private readonly parkedUntilMs = new Map<PeerIdStr, number>();

  constructor(
    private readonly limits: QuotaLimits,
    private readonly now: () => number = Date.now
  ) {}

  /** True while a peer is excluded after rate-limiting us. */
  isParked(peer: PeerIdStr): boolean {
    const until = this.parkedUntilMs.get(peer);
    if (until === undefined) return false;
    if (this.now() >= until) {
      this.parkedUntilMs.delete(peer);
      return false;
    }
    return true;
  }

  /** Exclude a peer (classifyRequestError → "parkPeer"). */
  parkPeer(peer: PeerIdStr, forMs: number = RATE_LIMITED_PARK_MS): void {
    this.parkedUntilMs.set(peer, this.now() + forMs);
  }

  /**
   * Reserve `units` of `kind` against `peer`. Returns true and records the
   * charge + in-flight slot, or false when the reservation would breach policy
   * (window budget, in-flight cap, spacing, or the peer is parked).
   */
  tryReserve(peer: PeerIdStr, kind: QuotaKind, units: number): boolean {
    if (this.isParked(peer)) return false;
    const limit = this.limits[kind];
    if (units > limit.maxUnits) return false;

    const nowMs = this.now();
    const s = this.getState(peer, kind, nowMs);
    if (s.inFlight >= limit.maxInFlight) return false;
    if (limit.minSpacingMs > 0 && s.lastGrantMs !== null && nowMs - s.lastGrantMs < limit.minSpacingMs) return false;

    const used = s.charges.reduce((sum, c) => sum + c.units, 0);
    if (used + units > limit.maxUnits) return false;

    s.charges.push({atMs: nowMs, units});
    s.inFlight++;
    s.lastGrantMs = nowMs;
    return true;
  }

  /** Release the in-flight slot after the request settles (success or failure). */
  release(peer: PeerIdStr, kind: QuotaKind): void {
    const s = this.state.get(peer)?.get(kind);
    if (s !== undefined && s.inFlight > 0) s.inFlight--;
  }

  /** Total in-flight requests to a peer across all protocols (least-active peer selection). */
  inFlightTotal(peer: PeerIdStr): number {
    const kinds = this.state.get(peer);
    if (kinds === undefined) return 0;
    let total = 0;
    for (const s of kinds.values()) total += s.inFlight;
    return total;
  }

  /**
   * Earliest time a reservation of `units` of `kind` at `peer` could be
   * granted (park expiry / spacing / window drain). `0` = grantable now.
   * Parking derives from OUR arithmetic — the platform exposes no remote view.
   */
  nextAvailableMs(peer: PeerIdStr, kind: QuotaKind, units: number): number {
    const nowMs = this.now();
    let at = this.parkedUntilMs.get(peer) ?? 0;

    const limit = this.limits[kind];
    const s = this.state.get(peer)?.get(kind);
    if (s === undefined) return at > nowMs ? at : 0;

    if (limit.minSpacingMs > 0 && s.lastGrantMs !== null) {
      at = Math.max(at, s.lastGrantMs + limit.minSpacingMs);
    }

    // Window budget: expire charges oldest-first until `units` fits.
    const charges = s.charges.filter((c) => nowMs - c.atMs < limit.windowMs);
    let used = charges.reduce((sum, c) => sum + c.units, 0);
    for (const c of charges) {
      if (used + units <= limit.maxUnits) break;
      at = Math.max(at, c.atMs + limit.windowMs);
      used -= c.units;
    }

    return at > nowMs ? at : 0;
  }

  /** Drop expired window charges and park entries (called from the per-slot scan). */
  prune(): void {
    const nowMs = this.now();
    for (const [peer, kinds] of this.state) {
      for (const [kind, s] of kinds) {
        const limit = this.limits[kind];
        s.charges = s.charges.filter((c) => nowMs - c.atMs < limit.windowMs);
        if (
          s.charges.length === 0 &&
          s.inFlight === 0 &&
          (s.lastGrantMs === null || nowMs - s.lastGrantMs > limit.windowMs * 2)
        ) {
          kinds.delete(kind);
        }
      }
      if (kinds.size === 0) this.state.delete(peer);
    }
    for (const [peer, until] of this.parkedUntilMs) {
      if (nowMs >= until) this.parkedUntilMs.delete(peer);
    }
  }

  private getState(peer: PeerIdStr, kind: QuotaKind, nowMs: number): PeerKindState {
    let kinds = this.state.get(peer);
    if (kinds === undefined) {
      kinds = new Map();
      this.state.set(peer, kinds);
    }
    let s = kinds.get(kind);
    if (s === undefined) {
      s = {charges: [], inFlight: 0, lastGrantMs: null};
      kinds.set(kind, s);
    } else {
      const windowMs = this.limits[kind].windowMs;
      s.charges = s.charges.filter((c) => nowMs - c.atMs < windowMs);
    }
    return s;
  }
}

// ---------------------------------------------------------------------------
// InvalidBytesLedger [A9] — prices deep-non-finality garbage-chain
// amplification. Every verified block a peer serves into a walk/fill is
// charged as PENDING against (target, peer); when the target reaches a
// terminal `invalid` / finality-conflict verdict the pending charge converts
// to COUNTED invalid bytes, and the peer eats a Low per 64 MB threshold
// crossed. Benign terminals discard the pending charge. Counted bytes decay
// with a half-life so a long-lived peer isn't punished forever for old sins.
// ---------------------------------------------------------------------------

export const INVALID_BYTES_REPORT_THRESHOLD = 64 * 1024 ** 2;
const INVALID_BYTES_HALF_LIFE_MS = 10 * 60_000;
const INVALID_BYTES_PRUNE_BELOW = 1024 ** 2;

export class InvalidBytesLedger {
  /** targetRoot → (peer → pending bytes served into that target). */
  private readonly pending = new Map<RootHex, Map<PeerIdStr, number>>();
  private readonly counted = new Map<PeerIdStr, {bytes: number; lastDecayMs: number}>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Charge bytes a peer served into a target (pending until the target's verdict). */
  charge(targetRoot: RootHex, peer: PeerIdStr, bytes: number): void {
    let peers = this.pending.get(targetRoot);
    if (peers === undefined) {
      peers = new Map();
      this.pending.set(targetRoot, peers);
    }
    peers.set(peer, (peers.get(peer) ?? 0) + bytes);
  }

  /**
   * Target proved invalid: convert its pending charges to counted bytes and
   * report each peer once per 64 MB threshold newly crossed.
   */
  settleInvalid(targetRoot: RootHex, reportPeer: (peer: PeerIdStr) => void): void {
    const peers = this.pending.get(targetRoot);
    this.pending.delete(targetRoot);
    if (peers === undefined) return;

    const nowMs = this.now();
    for (const [peer, bytes] of peers) {
      const entry = this.decayed(peer, nowMs);
      const before = Math.floor(entry.bytes / INVALID_BYTES_REPORT_THRESHOLD);
      entry.bytes += bytes;
      const after = Math.floor(entry.bytes / INVALID_BYTES_REPORT_THRESHOLD);
      this.counted.set(peer, entry);
      for (let i = before; i < after; i++) reportPeer(peer);
    }
  }

  /** Target reached a benign terminal: its pending charges never counted. */
  discard(targetRoot: RootHex): void {
    this.pending.delete(targetRoot);
  }

  /** Decay + prune (called from the per-slot scan). */
  sweep(): void {
    const nowMs = this.now();
    for (const [peer] of this.counted) {
      const entry = this.decayed(peer, nowMs);
      if (entry.bytes < INVALID_BYTES_PRUNE_BELOW) {
        this.counted.delete(peer);
      } else {
        this.counted.set(peer, entry);
      }
    }
  }

  countedBytes(peer: PeerIdStr): number {
    return this.decayed(peer, this.now()).bytes;
  }

  private decayed(peer: PeerIdStr, nowMs: number): {bytes: number; lastDecayMs: number} {
    const entry = this.counted.get(peer);
    if (entry === undefined) return {bytes: 0, lastDecayMs: nowMs};
    const dt = nowMs - entry.lastDecayMs;
    if (dt <= 0) return entry;
    return {bytes: entry.bytes * 0.5 ** (dt / INVALID_BYTES_HALF_LIFE_MS), lastDecayMs: nowMs};
  }
}
