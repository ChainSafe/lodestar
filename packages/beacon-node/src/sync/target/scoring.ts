import {INetwork} from "../../network/interface.js";
import {PeerAction} from "../../network/peers/score/index.js";
import {PeerIdStr} from "../../util/peerId.js";

type ScoringGateOpts = {
  cooldownMs: number;
  now(): number;
};

/**
 * Per-(peer, reason) backoff gate implementing the scoring deduplication policy.
 *
 * Prevents the same fault from being re-reported to `network.reportPeer` within
 * `cooldownMs` for the same (peer, reason) pair.  The injected `now` clock makes
 * this unit-testable without `Date.now()` appearing in the module.
 */
export class ScoringGate {
  private readonly seen = new Map<string, number>();
  private readonly opts: ScoringGateOpts;

  constructor(opts: ScoringGateOpts) {
    this.opts = opts;
  }

  report(network: Pick<INetwork, "reportPeer">, peer: PeerIdStr, reason: string, action: PeerAction): void {
    const t = this.opts.now();

    // Evict entries past their cooldown so `seen` stays bounded by recently-reported (peer, reason)
    // pairs rather than accreting one entry per distinct peer for the node's lifetime. Reports are
    // cooldown-gated and low-rate, so this O(n) sweep over a small map is negligible.
    for (const [k, last] of this.seen) {
      if (t - last >= this.opts.cooldownMs) {
        this.seen.delete(k);
      }
    }

    const key = `${peer}:${reason}`;
    if (this.seen.has(key)) {
      // Survived the sweep ⇒ within cooldown — suppress to avoid re-scoring the same fault.
      return;
    }

    network.reportPeer(peer, action, reason);
    this.seen.set(key, t);
  }
}
