import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {beaconNodeOptions, IBeaconNodeOptions} from "../../../../options/beaconNodeOptions";
import {defaultAccountPaths} from "../../paths";

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
    description: "Directory for storing validator keystores.",
    defaultDescription: defaultAccountPaths.keystoresDir,
    normalize: true,
    type: "string",
  } as Options,

  secretsDir: {
    description: "Directory for storing validator keystore secrets.",
    defaultDescription: defaultAccountPaths.secretsDir,
    normalize: true,
    type: "string",
  } as Options,
};
