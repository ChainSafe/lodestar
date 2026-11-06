import path from "node:path";
import {getNodeLogger} from "@lodestar/logger/node";
import {CliCommand} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {GlobalArgs} from "../../../options/index.js";
import {LogArgs} from "../../../options/logOptions.js";
import {
  exportInterchangeFile,
  interchangeFileOption,
  interchangeFormatVersion,
  interchangePubkeysOption,
} from "../../../util/interchange.js";
import {parseLoggerArgs} from "../../../util/logger.js";
import {AccountValidatorArgs} from "../options.js";
import {getValidatorPaths} from "../paths.js";
import {ISlashingProtectionArgs} from "./options.js";
import {getGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";

type ExportArgs = {
  file: string;
  pubkeys?: string[];
};

export const exportCmd: CliCommand<ExportArgs, ISlashingProtectionArgs & AccountValidatorArgs & GlobalArgs & LogArgs> =
  {
    command: "export",

    describe: "Export an interchange file.",

    examples: [
      {
        command: "validator slashing-protection export --network hoodi --file interchange.json",
        description: "Export an interchange JSON file for all validators in the slashing protection DB",
      },
    ],

    options: {
      file: {...interchangeFileOption, description: "The slashing protection interchange file to export to (.json)."},
      pubkeys: interchangePubkeysOption,
    },

    handler: async (args) => {
      const {file, pubkeys} = args;

      const {config, network} = getBeaconConfigFromArgs(args);
      const validatorPaths = getValidatorPaths(args, network);
      // slashingProtection commands are fast so do not require logFile feature
      const logger = getNodeLogger(
        parseLoggerArgs(args, {defaultLogFilepath: path.join(validatorPaths.dataDir, "validator.log")}, config)
      );

      const {validatorsDbDir: dbPath} = getValidatorPaths(args, network);

      logger.info("Exporting slashing protection data", {...interchangeFormatVersion, dbPath});

      const {slashingProtection, metadata} = await getSlashingProtection(args, network, logger);

      // When exporting validator DB should already have genesisValidatorsRoot persisted.
      // For legacy node and general fallback, fetch from:
      // - known genesis data from existing network
      // - else fetch from beacon node
      const genesisValidatorsRoot =
        (await metadata.getGenesisValidatorsRoot()) ?? (await getGenesisValidatorsRoot(args));

      await exportInterchangeFile(slashingProtection, genesisValidatorsRoot, {file, pubkeys}, logger);
    },
  };
