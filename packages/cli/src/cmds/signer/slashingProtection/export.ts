import path from "node:path";
import {getNodeLogger} from "@lodestar/logger/node";
import {CliCommand} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {GlobalArgs} from "../../../options/index.js";
import {YargsError} from "../../../util/index.js";
import {
  exportInterchangeFile,
  interchangeFileOption,
  interchangeFormatVersion,
  interchangePubkeysOption,
} from "../../../util/interchange.js";
import {parseLoggerArgs} from "../../../util/logger.js";
import {ISignerCliArgs} from "../options.js";
import {getSignerPaths} from "../paths.js";
import {getKnownGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";

type ExportArgs = {
  file: string;
  pubkeys?: string[];
};

export const exportCmd: CliCommand<ExportArgs, ISignerCliArgs & GlobalArgs> = {
  command: "export",

  describe: "Export an interchange file.",

  examples: [
    {
      command: "signer slashing-protection export --network hoodi --file interchange.json",
      description: "Export an interchange JSON file for all validators in the slashing protection DB of the signer",
    },
  ],

  options: {
    file: {...interchangeFileOption, description: "The slashing protection interchange file to export to (.json)."},
    pubkeys: interchangePubkeysOption,
  },

  handler: async (args) => {
    const {file, pubkeys} = args;

    const {config, network} = getBeaconConfigFromArgs(args);
    const signerPaths = getSignerPaths(args, network);
    // slashingProtection commands are fast so do not require logFile feature
    const logger = getNodeLogger(
      parseLoggerArgs(args, {defaultLogFilepath: path.join(signerPaths.dataDir, "signer.log")}, config)
    );

    logger.info("Exporting slashing protection data", {...interchangeFormatVersion, dbPath: signerPaths.signerDbDir});

    const {db, slashingProtection, metadata} = await getSlashingProtection(args, network, logger);

    const genesisValidatorsRoot = (await metadata.getGenesisValidatorsRoot()) ?? getKnownGenesisValidatorsRoot(network);
    if (genesisValidatorsRoot === null) {
      throw new YargsError(
        "Genesis validators root of the slashing protection DB is unknown, it is persisted once the signer serves a block or attestation signing request or an interchange file is imported"
      );
    }

    await exportInterchangeFile(slashingProtection, genesisValidatorsRoot, {file, pubkeys}, logger);
    await db.close();
  },
};
