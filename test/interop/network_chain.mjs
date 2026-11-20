import {createBeaconConfig} from "@lodestar/config";

export const testChain = createBeaconConfig(
  {
    ALTAIR_FORK_EPOCH: 0,
    ALTAIR_FORK_VERSION: Uint8Array.of(1, 0, 0, 0),
    BELLATRIX_FORK_EPOCH: 0,
    BELLATRIX_FORK_VERSION: Uint8Array.of(2, 0, 0, 0),
    BLOB_SCHEDULE: [{EPOCH: 2001, MAX_BLOBS_PER_BLOCK: 33}],
    CAPELLA_FORK_EPOCH: 0,
    CAPELLA_FORK_VERSION: Uint8Array.of(3, 0, 0, 0),
    DENEB_FORK_EPOCH: 0,
    DENEB_FORK_VERSION: Uint8Array.of(4, 0, 0, 0),
    ELECTRA_FORK_EPOCH: 1000,
    ELECTRA_FORK_VERSION: Uint8Array.of(5, 0, 0, 0),
    FULU_FORK_EPOCH: 2000,
    FULU_FORK_VERSION: Uint8Array.of(6, 0, 0, 0),
    GENESIS_FORK_VERSION: Uint8Array.of(0, 0, 0, 0),
    GLOAS_FORK_EPOCH: Infinity,
  },
  new Uint8Array(32)
);
