import {InterchangeFormatVersion} from "@lodestar/validator";
import {ICliCommand, writeFile} from "../../../util/index.js";
import {IGlobalArgs} from "../../../options/index.js";
import {AccountValidatorArgs} from "../options.js";
import {getCliLogger, ILogArgs} from "../../../util/index.js";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {getBeaconPaths} from "../../beacon/paths.js";
import {getValidatorPaths} from "../paths.js";
import {getGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";
import {ISlashingProtectionArgs} from "./options.js";

/* eslint-disable no-console */

interface IExportArgs {
  file: string;
}

export const exportCmd: ICliCommand<
  IExportArgs,
  ISlashingProtectionArgs & AccountValidatorArgs & IGlobalArgs & ILogArgs
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
    const beaconPaths = getBeaconPaths(args);
    const config = getBeaconConfigFromArgs(args);
    const logger = getCliLogger(args, beaconPaths, config);

    const {validatorsDbDir: dbPath} = getValidatorPaths(args);

    // TODO: Allow format version and pubkeys to be customized with CLI args
    const formatVersion: InterchangeFormatVersion = {version: "4", format: "complete"};
    logger.info("Exporting the slashing protection logs", {...formatVersion, dbPath});

    const {slashingProtection, metadata} = getSlashingProtection(args);

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
    writeFile(args.file, interchange);
    logger.verbose("Export completed successfully");
  },
};
