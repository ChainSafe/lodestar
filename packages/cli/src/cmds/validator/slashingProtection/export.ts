import path from "node:path";
import {InterchangeFormatVersion} from "@lodestar/validator";
import {getNodeLogger} from "@lodestar/logger/node";
import {CliCommand, toPubkeyHex} from "@lodestar/utils";
import {YargsError, ensure0xPrefix, isValidatePubkeyHex, writeFile600Perm} from "../../../util/index.js";
import {parseLoggerArgs} from "../../../util/logger.js";
import {GlobalArgs} from "../../../options/index.js";
import {LogArgs} from "../../../options/logOptions.js";
import {AccountValidatorArgs} from "../options.js";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {getValidatorPaths} from "../paths.js";
import {getGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";
import {ISlashingProtectionArgs} from "./options.js";

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
        command: "validator slashing-protection export --network holesky --file interchange.json",
        description: "Export an interchange JSON file for all validators in the slashing protection DB",
      },
    ],

    options: {
      file: {
        description: "The slashing protection interchange file to export to (.json).",
        demandOption: true,
        type: "string",
      },
      pubkeys: {
        description: "Export slashing protection data only for a given subset of public keys",
        type: "array",
        string: true, // Ensures the pubkey string is not automatically converted to numbers
        coerce: (pubkeys: string[]): string[] =>
          // Parse ["0x11,0x22"] to ["0x11", "0x22"]
          pubkeys
            .flatMap((item) => item.split(","))
            .map(ensure0xPrefix),
      },
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

      const formatVersion: InterchangeFormatVersion = {version: "5"};
      logger.info("Exporting slashing protection data", {...formatVersion, dbPath});

      const {slashingProtection, metadata} = await getSlashingProtection(args, network, logger);

      // When exporting validator DB should already have genesisValidatorsRoot persisted.
      // For legacy node and general fallback, fetch from:
      // - known genesis data from existing network
      // - else fetch from beacon node
      const genesisValidatorsRoot =
        (await metadata.getGenesisValidatorsRoot()) ?? (await getGenesisValidatorsRoot(args));

      logger.verbose("Fetching pubkeys from slashing protection db");
      const allPubkeys = await slashingProtection.listPubkeys();
      let pubkeysToExport = allPubkeys;

      if (args.pubkeys) {
        logger.verbose("Filtering by pubkeys from args", {count: args.pubkeys.length});
        const filteredPubkeys = [];

        for (const pubkeyHex of args.pubkeys) {
          if (!isValidatePubkeyHex(pubkeyHex)) {
            throw new YargsError(`Invalid pubkey ${pubkeyHex}`);
          }
          const existingPubkey = allPubkeys.find((pubkey) => toPubkeyHex(pubkey) === pubkeyHex);
          if (!existingPubkey) {
            logger.warn("Pubkey not found in slashing protection db", {pubkey: pubkeyHex});
          } else {
            filteredPubkeys.push(existingPubkey);
          }
        }

        pubkeysToExport = filteredPubkeys;
      }

      logger.info("Starting export for pubkeys found", {count: pubkeysToExport.length});
      const interchange = await slashingProtection.exportInterchange(
        genesisValidatorsRoot,
        pubkeysToExport,
        formatVersion,
        logger
      );

      logger.info("Writing slashing protection data", {file});
      writeFile600Perm(file, interchange);
      logger.info("Export completed successfully");
    },
  };
