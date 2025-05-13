import {ChainForkConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ZERO_HASH} from "../../src/constants/index.js";

/** default config with ZERO_HASH as genesisValidatorsRoot */
export const config = createBeaconConfig(chainConfig, ZERO_HASH);

export function getConfig(fork: ForkName, forkEpoch = 0): ChainForkConfig {
  switch (fork) {
    case ForkName.phase0:
      return config;
    case ForkName.altair:
      return createChainForkConfig({ALTAIR_FORK_EPOCH: forkEpoch});
    case ForkName.bellatrix:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: forkEpoch,
      });
    case ForkName.capella:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: forkEpoch,
      });
    case ForkName.deneb:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: forkEpoch,
        BLOB_SCHEDULE: [{EPOCH: forkEpoch, MAX_BLOBS_PER_BLOCK: 6}],
      });
    case ForkName.electra:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: forkEpoch,
        BLOB_SCHEDULE: [
          {EPOCH: 0, MAX_BLOBS_PER_BLOCK: 6},
          {EPOCH: forkEpoch, MAX_BLOBS_PER_BLOCK: 9},
        ],
      });
    case ForkName.fulu:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: forkEpoch,
        BLOB_SCHEDULE: [
          {EPOCH: 0, MAX_BLOBS_PER_BLOCK: 6},
          {EPOCH: 0, MAX_BLOBS_PER_BLOCK: 9},
        ],
      });
  }
}
