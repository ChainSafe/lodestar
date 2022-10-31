import {ForkName} from "@lodestar/params";
import {config} from "@lodestar/config/default";
import {IChainForkConfig, createIChainForkConfig} from "@lodestar/config";

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
  }
}
