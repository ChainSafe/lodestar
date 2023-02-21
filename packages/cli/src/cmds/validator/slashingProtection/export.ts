import path from "node:path";
import {InterchangeFormatVersion} from "@lodestar/validator";
import {CliCommand, writeFile600Perm} from "../../../util/index.js";
import {GlobalArgs} from "../../../options/index.js";
import {AccountValidatorArgs} from "../options.js";
import {getCliLogger, LogArgs} from "../../../util/index.js";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {getValidatorPaths} from "../paths.js";
import {getGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";
import {ISlashingProtectionArgs} from "./options.js";

type ExportArgs = {
  file: string;
};

export const exportCmd: CliCommand<
  ExportArgs,
  ISlashingProtectionArgs & AccountValidatorArgs & GlobalArgs & LogArgs
> = {
  command: "export",

  describe: "Export an interchange file.",

  examples: [
    {
      command: "validator slashing-protection export --network goerli --file interchange.json",
      description: "Export an interchange JSON file for all validators in the slashing protection DB",
    },
  ],

  options: {
    file: {
      description: "The slashing protection interchange file to export to (.json).",
      demandOption: true,
      type: "string",
    },
  },

  handler: async (args) => {
    const {config, network} = getBeaconConfigFromArgs(args);
    const validatorPaths = getValidatorPaths(args, network);
    // slashingProtection commands are fast so do not require logFile feature
    const {logger} = getCliLogger(
      args,
      {defaultLogFilepath: path.join(validatorPaths.dataDir, "validator.log")},
      config
    );

    const {validatorsDbDir: dbPath} = getValidatorPaths(args, network);

    // TODO: Allow format version and pubkeys to be customized with CLI args
    const formatVersion: InterchangeFormatVersion = {version: "4", format: "complete"};
    logger.info("Exporting the slashing protection logs", {...formatVersion, dbPath});

    const {slashingProtection, metadata} = getSlashingProtection(args, network, logger);

    // When exporting validator DB should already have genesisValidatorsRoot persisted.
    // For legacy node and general fallback, fetch from:
    // - known genesis data from existing network
    // - else fetch from beacon node
    const genesisValidatorsRoot = (await metadata.getGenesisValidatorsRoot()) ?? (await getGenesisValidatorsRoot(args));

    logger.verbose("Fetching the pubkeys from the slashingProtection db");
    const pubkeys = await slashingProtection.listPubkeys();

    logger.info("Starting export for pubkeys found", {pubkeys: pubkeys.length});
    const interchange = await slashingProtection.exportInterchange(
      genesisValidatorsRoot,
      pubkeys,
      formatVersion,
      logger
    );

    logger.info("Writing the slashing protection logs", {file: args.file});
    writeFile600Perm(args.file, interchange);
    logger.verbose("Export completed successfully");
  },
};
