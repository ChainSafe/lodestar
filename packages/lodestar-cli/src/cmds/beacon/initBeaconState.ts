import {AbortSignal} from "abort-controller";

import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "@chainsafe/lodestar/lib/db";
import {Eth1Provider} from "@chainsafe/lodestar/lib/eth1";
import {initStateFromAnchorState, initStateFromDb, initStateFromEth1} from "@chainsafe/lodestar/lib/chain";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node";

import {downloadOrLoadFile} from "../../util";
import {IBeaconArgs} from "./options";
import {defaultNetwork, IGlobalArgs} from "../../options/globalOptions";
import {getGenesisFileUrl} from "../../networks";

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
): Promise<TreeBacked<phase0.BeaconState>> {
  async function initFromFile(pathOrUrl: string): Promise<TreeBacked<phase0.BeaconState>> {
    const anchorState = config.types.phase0.BeaconState.tree.deserialize(await downloadOrLoadFile(pathOrUrl));
    return await initStateFromAnchorState(config, db, logger, anchorState);
  }

  const dbHasSomeState = (await db.stateArchive.lastKey()) != null;

  if (args.weakSubjectivityStateFile) {
    return await initFromFile(args.weakSubjectivityStateFile);
  } else if (dbHasSomeState) {
    return await initStateFromDb(config, db, logger);
  } else {
    const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
    if (genesisStateFile && !args.forceGenesis) {
      return await initFromFile(genesisStateFile);
    } else {
      return await initStateFromEth1(config, db, logger, new Eth1Provider(config, options.eth1), signal);
    }
  }
}
