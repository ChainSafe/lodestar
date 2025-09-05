import {waitForEndpoint} from "@lodestar/test-utils";

export const rpcUrl = "http://0.0.0.0:8001";
export const beaconUrl = "http://0.0.0.0:5001";
export const proxyPort = 8888;
export const chainId = 1234;
export const proxyUrl = `http://localhost:${proxyPort}`;

// All forks start at epoch 0
const secondsPerSlot = 4;
const altairForkEpoch = 0;
const bellatrixForkEpoch = 0;
const capellaForkEpoch = 0;
const denebForkEpoch = 0;
const electraForkEpoch = 0;
const genesisDelaySeconds = 30 * secondsPerSlot;

// Wait for at least 2 epochs to ensure light client can sync from a finalized checkpoint
export const minFinalizedTimeMs = 2 * 8 * 4 * 1000;

export const config = {
  ALTAIR_FORK_EPOCH: altairForkEpoch,
  BELLATRIX_FORK_EPOCH: bellatrixForkEpoch,
  CAPELLA_FORK_EPOCH: capellaForkEpoch,
  DENEB_FORK_EPOCH: denebForkEpoch,
  ELECTRA_FORK_EPOCH: electraForkEpoch,
  GENESIS_DELAY: genesisDelaySeconds,
  SECONDS_PER_SLOT: secondsPerSlot,
  SLOT_DURATION_MS: secondsPerSlot * 1000,
};

export function waitForFinalized(): Promise<void> {
  // Wait for 2 epochs to pass so that the light client can sync from a finalized checkpoint
  return waitForEndpoint(`${beaconUrl}/eth/v1/beacon/headers/${2 * 8}`);
}
