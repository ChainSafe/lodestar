import {config as chainConfig} from "@lodestar/config/default";
import {createIBeaconConfig, IChainForkConfig, createIChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {ZERO_HASH} from "../../src/constants/index.js";

/** default config with ZERO_HASH as genesisValidatorsRoot */
export const config = createIBeaconConfig(chainConfig, ZERO_HASH);

/* eslint-disable @typescript-eslint/naming-convention */
export function getConfig(fork: ForkName, forkEpoch = 0): IChainForkConfig {
  switch (fork) {
    case ForkName.phase0:
      return config;
    case ForkName.altair:
      return createIChainForkConfig({ALTAIR_FORK_EPOCH: forkEpoch});
    case ForkName.bellatrix:
      return createIChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: forkEpoch,
      });
    case ForkName.capella:
      return createIChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: forkEpoch,
      });
    case ForkName.deneb:
      return createIChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        EIP4844_FORK_EPOCH: forkEpoch,
      });
  }
}
