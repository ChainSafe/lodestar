import {BeaconProcessOpts, ValidatorProcessOpts, Eth2Client, SpwanOpts} from "./interface.js";
import {prepareBeaconNodeLodestarArgs, prepareValidatorLodestarArgs} from "./lodestar.js";

export function prepareBeaconNodeArgs(opts: BeaconProcessOpts): SpwanOpts {
  if (opts.client === Eth2Client.lodestar) {
    return prepareBeaconNodeLodestarArgs(opts);
  } else {
    throw Error(`Unknown client ${opts.client}`);
  }
}

export function prepareValidatorArgs(opts: ValidatorProcessOpts): SpwanOpts {
  if (opts.client === Eth2Client.lodestar) {
    return prepareValidatorLodestarArgs(opts);
  } else {
    throw Error(`Unknown client ${opts.client}`);
  }
}
