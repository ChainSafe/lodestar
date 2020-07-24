import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import {beaconRunOptions} from "../../beacon/cmds/run/options";
import {devOptions, IDevOptions} from "./dev";
import {syncOptions, ISyncOptions} from "./sync";
import {validatorOptions, IValidatorOptions} from "./validator";

export const devRunOptions = {
  ...beaconRunOptions,
  ...devOptions,
  ...syncOptions,
  ...validatorOptions,
};

export type IDevOptions = 
  Partial<IBeaconNodeOptions> &
  IDevOptions &
  ISyncOptions &
  IValidatorOptions;
