import path from "node:path";
import {getNodeLogger} from "@lodestar/logger/node";
import {CliCommand, fromHex} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../../config/index.js";
import {GlobalArgs} from "../../../options/index.js";
import {interchangeFileOption, readInterchangeFile} from "../../../util/interchange.js";
import {parseLoggerArgs} from "../../../util/logger.js";
import {ISignerCliArgs} from "../options.js";
import {getSignerPaths} from "../paths.js";
import {getKnownGenesisValidatorsRoot, getSlashingProtection} from "./utils.js";

type ImportArgs = {
  file: string;
};

export const importCmd: CliCommand<ImportArgs, ISignerCliArgs & GlobalArgs> = {
  command: "import",

  describe: "Import an interchange file.",

  examples: [
    {
      command: "signer slashing-protection import --network hoodi --file interchange.json",
      description: "Import an interchange file to the slashing protection DB of the signer",
    },
  ],

  options: {
    file: {...interchangeFileOption, description: "The slashing protection interchange file to import (.json)."},
  },

  handler: async (args) => {
    const {file} = args;

    const {config, network} = getBeaconConfigFromArgs(args);
    const signerPaths = getSignerPaths(args, network);
    // slashingProtection commands are fast so do not require logFile feature
    const logger = getNodeLogger(
      parseLoggerArgs(args, {defaultLogFilepath: path.join(signerPaths.dataDir, "signer.log")}, config)
    );

    logger.info("Importing slashing protection data", {dbPath: signerPaths.signerDbDir});

    const {db, slashingProtection, metadata} = await getSlashingProtection(args, network, logger);

    const interchange = await readInterchangeFile(file, logger);

    // The genesis validators root is taken from:
    // - existing persisted in signer DB
    // - known genesis data from existing network
    // - else the interchange file, the signer only signs for this chain from now on
    const persistedGenesisValidatorsRoot = await metadata.getGenesisValidatorsRoot();
    const genesisValidatorsRoot =
      persistedGenesisValidatorsRoot ??
      getKnownGenesisValidatorsRoot(network) ??
      fromHex(interchange.metadata.genesis_validators_root);

    await slashingProtection.importInterchange(interchange, genesisValidatorsRoot, logger);
    if (persistedGenesisValidatorsRoot === null) {
      await metadata.setGenesisValidatorsRoot(genesisValidatorsRoot);
    }
    await db.close();
    logger.info("Import completed successfully");
  },
};
