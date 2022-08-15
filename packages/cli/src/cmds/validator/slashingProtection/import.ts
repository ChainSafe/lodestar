import fs from "node:fs";
import {Interchange} from "@lodestar/validator";
import {ICliCommand} from "../../../util/index.js";
import {IGlobalArgs} from "../../../options/index.js";
import {AccountValidatorArgs} from "../options.js";
import {getCliLogger, ILogArgs} from "../../../util/index.js";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {getBeaconPaths} from "../../beacon/paths.js";
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
      command: "validator slashing-protection import --network prater --file interchange.json",
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
    const beaconPaths = getBeaconPaths(args);
    const config = getBeaconConfigFromArgs(args);
    const logger = getCliLogger(args, beaconPaths, config);

    const {validatorsDbDir: dbPath} = getValidatorPaths(args);

    logger.info("Importing the slashing protection logs", {dbPath});
    const genesisValidatorsRoot = await getGenesisValidatorsRoot(args);
    const slashingProtection = getSlashingProtection(args);

    logger.verbose("Reading the slashing protection logs", {file: args.file});
    const importFile = await fs.promises.readFile(args.file, "utf8");
    const importFileJson = JSON.parse(importFile) as Interchange;
    await slashingProtection.importInterchange(importFileJson, genesisValidatorsRoot, logger);
    logger.info("Import completed successfully");
  },
};
