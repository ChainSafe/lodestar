export const defaultOptions = {
  // Source beacon node the builder connects to
  beaconNodeUrl: "http://127.0.0.1:9596",
  requestTimeout: 10_000,

  bidding: {
    /** Share of the payload value offered to the proposer */
    shareBps: 9000,
    fixedCostGwei: 0,
    minValueGwei: 0,
    /** Fetch payloads and publish bids at 85% of the slot before the target slot */
    deadlineBps: 8500,
    prepareRetryMs: 250,
    getPayloadTimeoutMs: 1000,
    /** Do not bid when the builder balance falls below this, 1.1 ETH leaves headroom above MIN_DEPOSIT_AMOUNT */
    minOperatingBalanceGwei: 1_100_000_000,
  },
};
