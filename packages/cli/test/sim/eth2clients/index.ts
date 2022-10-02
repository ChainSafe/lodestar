import {BeaconProcessOpts, ValidatorProcessOpts, Eth2Client, SpwanOpts} from "./interface.js";
import {prepareBeaconNodeLodestarArgs, prepareValidatorLodestarArgs} from "./lodestar.js";
import {prepareLighthouse, prepareBeaconNodeLighthouseArgs, prepareValidatorLighthouseArgs} from "./lighthouse.js";

export async function prepareClient(opts: Pick<BeaconProcessOpts, "client">): Promise<void> {
  switch (opts.client) {
    case Eth2Client.lodestar:
      return;
    case Eth2Client.lighthouse:
      return prepareLighthouse();
    default:
      throw Error(`Unknown client ${opts.client}`);
  }
}

export function prepareBeaconNodeArgs(opts: BeaconProcessOpts): SpwanOpts {
  switch (opts.client) {
    case Eth2Client.lodestar:
      return prepareBeaconNodeLodestarArgs(opts);
    case Eth2Client.lighthouse:
      return prepareBeaconNodeLighthouseArgs(opts);
    default:
      throw Error(`Unknown client ${opts.client}`);
  }
}

export function prepareValidatorArgs(opts: ValidatorProcessOpts): SpwanOpts {
  switch (opts.client) {
    case Eth2Client.lodestar:
      return prepareValidatorLodestarArgs(opts);
    case Eth2Client.lighthouse:
      return prepareValidatorLighthouseArgs(opts);
    default:
      throw Error(`Unknown client ${opts.client}`);
  }
}
