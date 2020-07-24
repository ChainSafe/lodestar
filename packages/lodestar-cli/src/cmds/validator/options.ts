import {CommandBuilder, Options} from "yargs";
import {IGlobalArgs} from "../../options";
import {beaconNodeOptions, IBeaconNodeOptions} from "../../options/beaconNodeOptions";
import {defaultValidatorPaths} from "./paths";
import {accountValidatorOptions, IAccountValidatorOptions} from "../account/cmds/validator/options";
import {withDefaultValue} from "../../util";

export type IValidatorCliOptions = 
  IGlobalArgs &
  IAccountValidatorOptions &
  { chain: IBeaconNodeOptions["chain"] } &
  {
    validatorsDbDir?: string;
    server: string;
    force: boolean;
  };

export const validatorOptions: CommandBuilder<{}, IValidatorCliOptions> = {
  ...accountValidatorOptions,
  "chain.name": beaconNodeOptions["chain.name"],

  validatorsDbDir: {
    description: withDefaultValue("Data directory for validator databases.", defaultValidatorPaths.validatorsDbDir),
    alias: ["dbDir", "db.dir", "db.name"],
    normalize: true,
    type: "string",
  } as Options,

  server: {
    description: "Address to connect to BeaconNode",
    default: "http://127.0.0.1:9596",
    alias: ["server"],
    type: "string"
  } as Options,

  force: {
    description: "Open validators even if there's a lockfile. Use with caution",
    type: "boolean"
  } as Options
};

