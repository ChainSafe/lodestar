import {AbortSignal} from "abort-controller";
import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {fromHex, ILogger} from "@chainsafe/lodestar-utils";
import {allForks} from "@chainsafe/lodestar-types";
import {isWithinWeakSubjectivityPeriod} from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/util/weakSubjectivity";
import {
  IBeaconDb,
  Eth1Provider,
  IBeaconNodeOptions,
  initStateFromAnchorState,
  initStateFromDb,
  initStateFromEth1,
} from "@chainsafe/lodestar";
import {getStateTypeFromBytes} from "@chainsafe/lodestar/lib/util/multifork";
import {downloadOrLoadFile} from "../../util";
import {IBeaconArgs} from "./options";
import {defaultNetwork, IGlobalArgs} from "../../options/globalOptions";
import {getGenesisFileUrl} from "../../networks";
import {WeakSubjectivityServers, getWeakSubjectivityState} from "../weakSubjectivityState";
import {Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

async function initAndVerifyWeakSujectivityState(
  config: IBeaconConfig,
  db: IBeaconDb,
  wsState: TreeBacked<allForks.BeaconState>,
  logger: ILogger,
  wsCheckpoint?: Checkpoint
): Promise<TreeBacked<allForks.BeaconState>> {
  if (!isWithinWeakSubjectivityPeriod(config, wsState.genesisTime, wsState, wsCheckpoint)) {
    throw new Error("Fetched weak subjectivity checkpoint not within weak subjectivity period.");
  }
  return await initStateFromAnchorState(config, db, logger, wsState);
}

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
): Promise<TreeBacked<allForks.BeaconState>> {
  async function initFromFile(pathOrUrl: string): Promise<TreeBacked<allForks.BeaconState>> {
    const stateBytes = await downloadOrLoadFile(pathOrUrl);
    const anchorState = getStateTypeFromBytes(config, stateBytes).createTreeBackedFromBytes(stateBytes);
    return await initStateFromAnchorState(config, db, logger, anchorState as TreeBacked<allForks.BeaconState>);
  }

  const dbHasSomeState = (await db.stateArchive.lastKey()) != null;

  if (args.weakSubjectivityStateFile) {
    return await initFromFile(args.weakSubjectivityStateFile);
  } else if (dbHasSomeState) {
    return await initStateFromDb(config, db, logger);
  } else if (args.fetchChainSafeWeakSubjecitivtyState && args.network !== "dev" && args.network !== "oonoonba") {
    let checkpoint;
    let stateId = "finalized";
    if (args.weakSubjectivityCheckpoint) {
      const wsCheckpointData = args.weakSubjectivityCheckpoint.split(":");
      checkpoint = {root: fromHex(wsCheckpointData[0]), epoch: parseInt(wsCheckpointData[1])};
      stateId = args.weakSubjectivityCheckpoint && (checkpoint.epoch * SLOTS_PER_EPOCH).toString();
    }

    const state = await getWeakSubjectivityState(
      config,
      args,
      stateId,
      args.weakSubjecivityServerUrl || WeakSubjectivityServers[args.network],
      logger
    );
    return initAndVerifyWeakSujectivityState(config, db, state, logger, checkpoint);
  } else {
    const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
    if (genesisStateFile && !args.forceGenesis) {
      return await initFromFile(genesisStateFile);
    } else {
      return await initStateFromEth1(config, db, logger, new Eth1Provider(config, options.eth1), signal);
    }
  }
}
