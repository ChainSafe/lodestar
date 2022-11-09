import fs from "node:fs";
import path from "node:path";
import {Interchange} from "@lodestar/validator";
import {ICliCommand} from "../../../util/index.js";
import {IGlobalArgs} from "../../../options/index.js";
import {AccountValidatorArgs} from "../options.js";
import {getCliLogger, ILogArgs} from "../../../util/index.js";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {getValidatorPaths} from "../paths.js";
import {getGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";
import {ISlashingProtectionArgs} from "./options.js";

/* eslint-disable no-console */

interface IImportArgs {
  file: string;
}

export const importCmd: ICliCommand<
  IImportArgs,
  ISlashingProtectionArgs & AccountValidatorArgs & IGlobalArgs & ILogArgs
> = {
  command: "import",

  describe: "Import an interchange file.",

  examples: [
    {
      command: "validator slashing-protection import --network goerli --file interchange.json",
      description: "Import an interchange file to the slashing protection DB",
    },
  ],

  options: {
    file: {
      description: "The slashing protection interchange file to import (.json).",
      demandOption: true,
      type: "string",
    },
  },

  handler: async (args) => {
    const {config, network} = getBeaconConfigFromArgs(args);
    const validatorPaths = getValidatorPaths(args, network);
    // slashingProtection commands are fast so do not require logFile feature
    const logger = getCliLogger(args, {defaultLogFilepath: path.join(validatorPaths.dataDir, "validator.log")}, config);

    const {validatorsDbDir: dbPath} = getValidatorPaths(args, network);

    logger.info("Importing the slashing protection logs", {dbPath});

    const {slashingProtection, metadata} = getSlashingProtection(args, network);

    // Fetch genesisValidatorsRoot from:
    // - existing cached in validator DB
    // - known genesis data from existing network
    // - else fetch from beacon node
    const genesisValidatorsRoot = (await metadata.getGenesisValidatorsRoot()) ?? (await getGenesisValidatorsRoot(args));

    logger.verbose("Reading the slashing protection logs", {file: args.file});
    const interchangeStr = await fs.promises.readFile(args.file, "utf8");
    const interchangeJson = JSON.parse(interchangeStr) as Interchange;

    await slashingProtection.importInterchange(interchangeJson, genesisValidatorsRoot, logger);
    logger.info("Import completed successfully");
  },
};
