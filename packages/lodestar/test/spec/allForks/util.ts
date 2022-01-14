import {ForkName} from "@chainsafe/lodestar-params";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {config as phase0Config} from "../phase0/util";
import {config as altairConfig} from "../altair/util";
import {config as bellatrixConfig} from "../bellatrix/util";

export function getConfig(fork: ForkName): IChainForkConfig {
  switch (fork) {
    case ForkName.phase0:
      return phase0Config;
    case ForkName.altair:
      return altairConfig;
    case ForkName.bellatrix:
      return bellatrixConfig;
  }
}
