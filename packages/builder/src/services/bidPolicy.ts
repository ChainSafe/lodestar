import {Slot} from "@lodestar/types";

export type BidContext = {
  /** Proposal slot the bid is for */
  slot: Slot;
  /** Value of the payload to the builder's fee recipient, as reported by the execution client */
  payloadValueGwei: number;
  /** Builder balance that can back a bid, excess over the minimum and unsettled payments */
  coverableGwei: number;
};

/** Decides how much to pay the proposer for a payload, null means do not bid */
export interface BidPolicy {
  computeValue(ctx: BidContext): number | null;
}

export type ProportionalBidPolicyOpts = {
  /** Share of the payload value offered to the proposer, in basis points */
  shareBps: number;
  /** Fixed amount deducted from the share, e.g. to cover operating cost */
  fixedCostGwei: number;
  /** Fixed amount added on top of the share, paid from the builder balance */
  subsidyGwei?: number;
  /** Only add the subsidy to bids for proposal slots up to and including this slot, every bid if unset */
  subsidyUntilSlot?: Slot;
  /** Never bid below this value */
  minValueGwei: number;
  /** Never bid above this value */
  maxValueGwei?: number;
};

/**
 * Offers a fixed share of the payload value plus an optional subsidy, bounded by the configured
 * limits and the builder's coverable balance. Independent of competing bids.
 */
export class ProportionalBidPolicy implements BidPolicy {
  constructor(private readonly opts: ProportionalBidPolicyOpts) {
    if (!Number.isSafeInteger(opts.shareBps) || opts.shareBps < 0 || opts.shareBps > 10_000) {
      throw Error(`Invalid shareBps=${opts.shareBps}, must be an integer within [0, 10000]`);
    }

    if (!Number.isSafeInteger(opts.fixedCostGwei) || opts.fixedCostGwei < 0) {
      throw Error(`Invalid fixedCostGwei=${opts.fixedCostGwei}, must be a non-negative safe integer`);
    }

    if (opts.subsidyGwei !== undefined && (!Number.isSafeInteger(opts.subsidyGwei) || opts.subsidyGwei < 0)) {
      throw Error(`Invalid subsidyGwei=${opts.subsidyGwei}, must be a non-negative safe integer`);
    }

    if (
      opts.subsidyUntilSlot !== undefined &&
      (!Number.isSafeInteger(opts.subsidyUntilSlot) || opts.subsidyUntilSlot < 0)
    ) {
      throw Error(`Invalid subsidyUntilSlot=${opts.subsidyUntilSlot}, must be a non-negative safe integer`);
    }

    if (!Number.isSafeInteger(opts.minValueGwei) || opts.minValueGwei < 0) {
      throw Error(`Invalid minValueGwei=${opts.minValueGwei}, must be a non-negative safe integer`);
    }

    if (
      opts.maxValueGwei !== undefined &&
      (!Number.isSafeInteger(opts.maxValueGwei) || opts.maxValueGwei < opts.minValueGwei)
    ) {
      throw Error(
        `Invalid maxValueGwei=${opts.maxValueGwei}, must be a safe integer greater than or equal to minValueGwei=${opts.minValueGwei}`
      );
    }
  }

  computeValue({slot, payloadValueGwei, coverableGwei}: BidContext): number | null {
    const proportionalValue = Number((BigInt(payloadValueGwei) * BigInt(this.opts.shareBps)) / 10_000n);
    const {subsidyUntilSlot} = this.opts;
    const subsidy = subsidyUntilSlot === undefined || slot <= subsidyUntilSlot ? (this.opts.subsidyGwei ?? 0) : 0;
    const share = proportionalValue - this.opts.fixedCostGwei + subsidy;
    // This will override `fixedCostGwei` for the sake of fulfilling `minValueGwei`
    let value = Math.max(this.opts.minValueGwei, share);
    if (this.opts.maxValueGwei !== undefined) {
      value = Math.min(value, this.opts.maxValueGwei);
    }
    if (value > coverableGwei) {
      return null;
    }
    return value;
  }
}
