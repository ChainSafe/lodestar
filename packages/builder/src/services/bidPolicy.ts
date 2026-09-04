export type BidContext = {
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
  /** Never bid below this value */
  minValueGwei: number;
  /** Never bid above this value */
  maxValueGwei?: number;
};

/**
 * Offers a fixed share of the payload value, bounded by the configured limits and the
 * builder's coverable balance. Independent of competing bids.
 */
export class ProportionalBidPolicy implements BidPolicy {
  constructor(private readonly opts: ProportionalBidPolicyOpts) {
    if (opts.shareBps < 0 || opts.shareBps > 10_000) {
      throw Error(`Invalid shareBps=${opts.shareBps}, must be within [0, 10000]`);
    }

    if (opts.minValueGwei < 0) {
      throw Error(`Invalid minValueGwei=${opts.minValueGwei}, must be a positive number`);
    }

    if (opts.maxValueGwei !== undefined && opts.maxValueGwei < opts.minValueGwei) {
      throw Error(
        `Invalid maxValueGwei=${opts.maxValueGwei}, must be greater than or equal to minValueGwei=${opts.minValueGwei}`
      );
    }
  }

  computeValue({payloadValueGwei, coverableGwei}: BidContext): number | null {
    const share = Math.floor((payloadValueGwei * this.opts.shareBps) / 10_000) - this.opts.fixedCostGwei;
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
