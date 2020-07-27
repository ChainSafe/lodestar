import {CommandBuilder, Options} from "yargs";
import {IGlobalArgs} from "../../options";
import {defaultValidatorPaths} from "./paths";
import {accountValidatorOptions, IAccountValidatorOptions} from "../account/cmds/validator/options";

export type IValidatorCliOptions = 
  IGlobalArgs &
  IAccountValidatorOptions &
  {
    validatorsDbDir?: string;
    server: string;
    force: boolean;
    graffiti: string;
  };

export const validatorOptions: CommandBuilder<{}, IValidatorCliOptions> = {
  ...accountValidatorOptions,

  validatorsDbDir: {
    description: "Data directory for validator databases.",
    defaultDescription: defaultValidatorPaths.validatorsDbDir,
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
  } as Options,

  graffiti: {
    description: "Specify your custom graffiti to be included in blocks (plain ASCII text, 32 characters max)",
    ///////// |-------must be this long------|
    default: "chainsafe/lodestar-version-x.x.x",
    type: "string"
  }
};

