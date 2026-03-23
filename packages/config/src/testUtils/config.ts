import {ForkName} from "@lodestar/params";
import {config as chainConfig} from "../default.js";
import {ChainForkConfig, createBeaconConfig, createChainForkConfig} from "../index.js";

export const ZERO_HASH = Buffer.alloc(32, 0);

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
      });
    case ForkName.electra:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: forkEpoch,
      });
    case ForkName.fulu:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: forkEpoch,
        BLOB_SCHEDULE: [],
      });
    case ForkName.gloas:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: forkEpoch,
        BLOB_SCHEDULE: [],
      });
  }
}
