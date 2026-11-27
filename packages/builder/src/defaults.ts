import {MIN_DEPOSIT_AMOUNT} from "@lodestar/params";

export const defaultOptions = {
  // Source beacon node the builder connects to
  beaconNodeUrl: "http://127.0.0.1:9596",
  requestTimeout: 10_000,

  bidding: {
    /** Share of the payload value offered to the proposer, the full value by default */
    shareBps: 10_000,
    fixedCostGwei: 0,
    minValueGwei: 0,
    /** Retrieve the payload and publish the bid at 95% of the slot before the proposal slot */
    deadlineBps: 9500,
    getPayloadTimeout: 1000,
    /** Do not bid when the builder balance falls below this, bids are only covered by the balance above the deposit minimum */
    minOperatingBalanceGwei: MIN_DEPOSIT_AMOUNT,
  },
};
