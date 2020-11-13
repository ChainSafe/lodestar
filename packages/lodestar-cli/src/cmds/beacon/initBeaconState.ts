import {AbortSignal} from "abort-controller";

import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "@chainsafe/lodestar/lib/db";
import {Eth1Provider} from "@chainsafe/lodestar/lib/eth1";
import {initStateFromAnchorState, initStateFromDb, initStateFromEth1} from "@chainsafe/lodestar/lib/chain";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node";

import {downloadOrLoadFile} from "../../util";
import {IBeaconArgs} from "./options";
import {IGlobalArgs} from "../../options/globalOptions";
import {getGenesisFileUrl} from "../../testnets";

/**
 * Initialize a beacon state, picking the strategy based on the `IBeaconArgs`
 *
 * State is initialized in one of three ways:
 * 1. restore from a file (possibly downloaded via URL)
 * 2. restore from db
 * 3. create from eth1
 */
export async function initBeaconState(
  options: IBeaconNodeOptions,
  args: IBeaconArgs & IGlobalArgs,
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  signal: AbortSignal
): Promise<TreeBacked<BeaconState>> {
  const shouldInitFromFile = Boolean(args.weakSubjectivityStateFile || (!args.forceGenesis && args.genesisStateFile));
  const shouldInitFromDb = (await db.stateArchive.lastKey()) != null;
  let anchorState;

  if (args.testnet && !args.genesisStateFile) {
    args.genesisStateFile = getGenesisFileUrl(args.testnet) ?? undefined;
  }

  if (shouldInitFromFile) {
    const anchorStateFile = (args.weakSubjectivityStateFile || args.genesisStateFile) as string;
    anchorState = await initStateFromAnchorState(
      config,
      db,
      logger,
      config.types.BeaconState.tree.deserialize(await downloadOrLoadFile(anchorStateFile))
    );
  } else if (shouldInitFromDb) {
    anchorState = await initStateFromDb(config, db, logger);
  } else {
    anchorState = await initStateFromEth1(config, db, logger, new Eth1Provider(config, options.eth1), signal);
  }
  return anchorState;
}
