import {ForkName} from "@chainsafe/lodestar-params";
import {config} from "@chainsafe/lodestar-config/default";
import {IChainForkConfig, createIChainForkConfig} from "@chainsafe/lodestar-config";

/* eslint-disable @typescript-eslint/naming-convention */

export function getConfig(fork: ForkName): IChainForkConfig {
  switch (fork) {
    case ForkName.phase0:
      return config;
    case ForkName.altair:
      return createIChainForkConfig({ALTAIR_FORK_EPOCH: 0});
    case ForkName.bellatrix:
      return createIChainForkConfig({ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0});
  }
}
