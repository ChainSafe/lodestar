import path from "node:path";
import {getNodeLogger} from "@lodestar/logger/node";
import {CliCommand} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {GlobalArgs} from "../../../options/index.js";
import {LogArgs} from "../../../options/logOptions.js";
import {interchangeFileOption, readInterchangeFile} from "../../../util/interchange.js";
import {parseLoggerArgs} from "../../../util/logger.js";
import {AccountValidatorArgs} from "../options.js";
import {getValidatorPaths} from "../paths.js";
import {ISlashingProtectionArgs} from "./options.js";
import {getGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";

type ImportArgs = {
  file: string;
};

export const importCmd: CliCommand<ImportArgs, ISlashingProtectionArgs & AccountValidatorArgs & GlobalArgs & LogArgs> =
  {
    command: "import",

    describe: "Import an interchange file.",

    examples: [
      {
        command: "validator slashing-protection import --network hoodi --file interchange.json",
        description: "Import an interchange file to the slashing protection DB",
      },
    ],

    options: {
      file: {...interchangeFileOption, description: "The slashing protection interchange file to import (.json)."},
    },

    handler: async (args) => {
      const {file} = args;

      const {config, network} = getBeaconConfigFromArgs(args);
      const validatorPaths = getValidatorPaths(args, network);
      // slashingProtection commands are fast so do not require logFile feature
      const logger = getNodeLogger(
        parseLoggerArgs(args, {defaultLogFilepath: path.join(validatorPaths.dataDir, "validator.log")}, config)
      );

      const {validatorsDbDir: dbPath} = getValidatorPaths(args, network);

      logger.info("Importing slashing protection data", {dbPath});

      const {slashingProtection, metadata} = await getSlashingProtection(args, network, logger);

      // Fetch genesisValidatorsRoot from:
      // - existing cached in validator DB
      // - known genesis data from existing network
      // - else fetch from beacon node
      const genesisValidatorsRoot =
        (await metadata.getGenesisValidatorsRoot()) ?? (await getGenesisValidatorsRoot(args));

      const interchange = await readInterchangeFile(file, logger);

      await slashingProtection.importInterchange(interchange, genesisValidatorsRoot, logger);
      logger.info("Import completed successfully");
    },
  };
