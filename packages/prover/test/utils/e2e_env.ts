import {waitForEndpoint} from "@lodestar/test-utils";

export const rpcUrl = "http://0.0.0.0:8001";
export const beaconUrl = "http://0.0.0.0:5001";
export const proxyPort = 8888;
export const chainId = 1234;
export const proxyUrl = `http://localhost:${proxyPort}`;

// Wait for at least teh capella fork to be started
const secondsPerSlot = 4;
const altairForkEpoch = 1;
const bellatrixForkEpoch = 2;
const capellaForkEpoch = 3;
const genesisDelaySeconds = 30 * secondsPerSlot;

// Wait for at least the capella fork to be started
export const minCapellaTimeMs = (capellaForkEpoch + 2) * 8 * 4 * 1000;

export const config = {
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  GENESIS_DELAY: genesisDelaySeconds,
  SECONDS_PER_SLOT: secondsPerSlot,
};

export function waitForCapellaFork(): Promise<void> {
  // Wait for the two epoch of capella to pass so that the light client can sync from a finalized checkpoint
  return waitForEndpoint(`${beaconUrl}/eth/v1/beacon/headers/${(capellaForkEpoch + 2) * 8}`);
}
