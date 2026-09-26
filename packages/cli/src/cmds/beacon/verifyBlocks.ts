import {BeaconDb} from "@lodestar/beacon-node";
import {LevelDbController} from "@lodestar/db/controller/level";
import {CliCommand} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/index.js";
import {GlobalArgs} from "../../options/index.js";
import {initLogger} from "./handler.js";
import {BeaconArgs} from "./options.js";
import {getBeaconPaths} from "./paths.js";

export const verifyBlocks: CliCommand<BeaconArgs, GlobalArgs> = {
  command: "verify-blocks",
  describe:
    "Verify that hot and archived blocks stored before the block size cap fit MAX_PAYLOAD_SIZE, so native serving can read them. Until then native serving refuses them with RESOURCE_UNAVAILABLE, on which some clients disconnect. Run with the beacon node stopped; an interrupted archive pass resumes.",
  examples: [
    {
      command: "beacon verify-blocks --network hoodi",
      description: "Verify the hot and archived blocks of the hoodi beacon node database",
    },
  ],
  handler: async (args) => {
    const {config, network} = getBeaconConfigFromArgs(args);
    const beaconPaths = getBeaconPaths(args, network);
    const logger = initLogger(args, beaconPaths.dataDir, config, "verify-blocks.log");
    const db = new BeaconDb(config, await LevelDbController.create({name: beaconPaths.dbDir}, {metrics: null, logger}));
    try {
      const unverified = await db.blockCertification.load();
      if (unverified === null) {
        logger.info("Archived blocks are verified");
      } else {
        logger.info("Verifying archived blocks", {fromSlot: unverified.from, toSlot: unverified.to});
        const oversized = await db.blockCertification.verifyArchive({
          onProgress: (slot) => logger.info("Verified archived blocks", {throughSlot: slot, toSlot: unverified.to}),
        });
        if (oversized !== null) {
          throw Error(
            `Archived block at slot ${oversized.slot} root ${oversized.root} has ${oversized.bytes} bytes, above MAX_PAYLOAD_SIZE ${config.MAX_PAYLOAD_SIZE}; serving refuses it and later archived blocks with RESOURCE_UNAVAILABLE, on which some clients disconnect`
          );
        }
        logger.info("Archived blocks verified");
      }
      // After the archive pass, so its saved progress advances even while a hot block is oversized
      const hot = await db.blockCertification.scanHot();
      if (hot !== null) {
        throw Error(
          `Hot block at slot ${hot.slot} root ${hot.root} has ${hot.bytes} bytes, above MAX_PAYLOAD_SIZE ${config.MAX_PAYLOAD_SIZE}; while it stays in the hot database, serving refuses every stored block with RESOURCE_UNAVAILABLE, on which some clients disconnect`
        );
      }
      logger.info("Hot blocks verified");
    } finally {
      await db.close();
    }
  },
};
