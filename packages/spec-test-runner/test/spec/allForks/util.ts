import {ForkName} from "@chainsafe/lodestar-params";
import {config as altairConfig} from "../altair/util";
import {config as phase0Config} from "../phase0/util";

export function getConfig(fork: ForkName) {
  switch (fork) {
    case ForkName.phase0:
      return phase0Config;
    case ForkName.altair:
      return altairConfig;
  }
}
