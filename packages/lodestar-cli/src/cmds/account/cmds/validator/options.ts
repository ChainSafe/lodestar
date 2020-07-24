import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {beaconNodeOptions, IBeaconNodeOptions} from "../../../../options/beaconNodeOptions";
import {defaultAccountPaths} from "../../paths";
import {withDefaultValue} from "../../../../util";

export type IAccountValidatorOptions = 
  IGlobalArgs & 
  { chain: IBeaconNodeOptions["chain"] } &
  {
    keystoresDir?: string;
    secretsDir?: string;
    chain: {
      name: string;
    };
  };

export const accountValidatorOptions = {
  "chain.name": beaconNodeOptions["chain.name"],

  keystoresDir: {
    description: withDefaultValue("Directory for storing validator keystores.", defaultAccountPaths.keystoresDir),
    normalize: true,
    type: "string",
  } as Options,

  secretsDir: {
    description: withDefaultValue("Directory for storing validator keystore secrets.", defaultAccountPaths.secretsDir),
    normalize: true,
    type: "string",
  } as Options,
};
