import {MAX_BID_REVISIONS_PER_SLOT} from "./services/commitmentLimits.js";

export const defaultOptions = {
  // Source beacon node the builder connects to
  beaconNodeUrl: "http://127.0.0.1:9596",
  requestTimeout: 10_000,

  proposerPreferences: {
    /** Deadline for polling proposer preferences from a beacon node, keeps slot ticks short */
    timeoutMs: 1000,
  },

  bidding: {
    /** Share of the payload value offered to the proposer */
    shareBps: 9000,
    fixedCostGwei: 0,
    subsidyGwei: 0,
    minValueGwei: 0,
    /** Retrieve the payload and publish the bid at 95% of the slot before the proposal slot */
    deadlineBps: 9500,
    getPayloadTimeout: 1000,
    updateIntervalMs: 0,
    updateCutoffBps: 1000,
    maxRevisionsPerSlot: MAX_BID_REVISIONS_PER_SLOT,
    alternateBranches: false,
    alternateGossip: false,
    primaryHandoff: false,
    alternateBuildDurationMs: 500,
    alternateRefreshBeforeSlotMs: 0,
    deferUnusedGossipStages: false,
    /** Do not bid when the builder balance falls below this, 1.1 ETH leaves headroom above MIN_DEPOSIT_AMOUNT */
    minOperatingBalanceGwei: 1_100_000_000,
  },

  reveal: {
    /** Past the payload attestation deadline, the PTC votes the payload as not present */
    adversarialDelayExecutionPayloadBps: 8000,
  },
};
