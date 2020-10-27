import * as fs from "fs";
import {AbortSignal} from "abort-controller";

import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "@chainsafe/lodestar/lib/db";
import {Eth1Provider} from "@chainsafe/lodestar/lib/eth1";
import {initStateFromAnchorState, initStateFromDb, initStateFromEth1} from "@chainsafe/lodestar/lib/chain";

import {IBeaconArgs} from "./options";

/**
 * Initialize a beacon state, picking the strategy based on the `IBeaconArgs`
 *
 * State is initialized in one of three ways:
 * 1. restore from a file
 * 2. restore from db
 * 3. create from eth1
 */
export async function initBeaconState(
  options: IBeaconArgs,
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  signal: AbortSignal
): Promise<TreeBacked<BeaconState>> {
  const shouldInitFromFile = Boolean(
    options.weakSubjectivityStateFile || (!options.forceGenesis && options.genesisStateFile)
  );
  const shouldInitFromDb = (await db.stateArchive.lastKey()) != null;
  let anchorState;
  if (shouldInitFromFile) {
    const anchorStateFile = (options.weakSubjectivityStateFile || options.genesisStateFile) as string;
    anchorState = await initStateFromAnchorState(
      config,
      db,
      logger,
      config.types.BeaconState.tree.deserialize(await fs.promises.readFile(anchorStateFile))
    );
  } else if (shouldInitFromDb) {
    anchorState = await initStateFromDb(config, db, logger);
  } else {
    anchorState = await initStateFromEth1(config, db, logger, new Eth1Provider(config, options.eth1), signal);
  }
  return anchorState;
}
