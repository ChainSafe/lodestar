import {AbortSignal} from "abort-controller";
import {TreeBacked} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {fromHex, ILogger} from "@chainsafe/lodestar-utils";
import {allForks} from "@chainsafe/lodestar-types";
import {
  getLatestBlockRoot,
  isWithinWeakSubjectivityPeriod,
} from "@chainsafe/lodestar-beacon-state-transition/lib/allForks/util/weakSubjectivity";
import {
  IBeaconDb,
  Eth1Provider,
  IBeaconNodeOptions,
  initStateFromAnchorState,
  initStateFromEth1,
} from "@chainsafe/lodestar";
import {getStateTypeFromBytes} from "@chainsafe/lodestar/lib/util/multifork";
import {downloadOrLoadFile} from "../../util";
import {IBeaconArgs} from "./options";
import {defaultNetwork, IGlobalArgs} from "../../options/globalOptions";
import {getGenesisFileUrl} from "../../networks";
import {weakSubjectivityServers, getWeakSubjectivityState, WeakSubjectivityServer} from "../weakSubjectivityState";
import {Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {computeEpochAtSlot} from "../../../../beacon-state-transition/lib";

const checkpointRegex = new RegExp("^(?:0x)?([0-9a-f]{64}):([0-9]+)$");

function getCheckpointFromArg(checkpointStr: string): Checkpoint {
  const match = checkpointRegex.exec(checkpointStr.toLowerCase());
  if (!match) {
    throw new Error(`Could not parse checkpoint string: ${checkpointStr}`);
  }
  return {root: fromHex(match[1]), epoch: parseInt(match[2])};
}

function getCheckpointFromState(config: IBeaconConfig, state: allForks.BeaconState): Checkpoint {
  return {
    epoch: computeEpochAtSlot(state.latestBlockHeader.slot),
    root: getLatestBlockRoot(config, state),
  };
}

async function initAndVerifyWeakSubjectivityState(
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  store: TreeBacked<allForks.BeaconState>,
  wsState: TreeBacked<allForks.BeaconState>,
  wsCheckpoint: Checkpoint
): Promise<TreeBacked<allForks.BeaconState>> {
  if (!isWithinWeakSubjectivityPeriod(config, store, wsState, wsCheckpoint)) {
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
  // fetch the latest state stored in the db
  // this will be used in all cases, if it exists, either used during verification of a weak subjectivity state, or used directly as the anchor state
  const lastDbState = await db.stateArchive.lastValue();

  if (args.weakSubjectivityStateFile) {
    // weak subjectivity sync from a provided state file:
    // if a weak subjectivity checkpoint has been provided, it is used for additional verification
    // otherwise, the state itself is used for verification (not bad, because the trusted state has been explicitly provided)
    const stateBytes = await downloadOrLoadFile(args.weakSubjectivityStateFile);
    const wsState = getStateTypeFromBytes(config, stateBytes).createTreeBackedFromBytes(stateBytes);
    const store = lastDbState ?? wsState;
    const checkpoint = args.weakSubjectivityCheckpoint
      ? getCheckpointFromArg(args.weakSubjectivityCheckpoint)
      : getCheckpointFromState(config, wsState);
    return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsState, checkpoint);
  } else if (args.weakSubjectivitySyncLatest) {
    // weak subjectivity sync from a state that needs to be fetched:
    // if a weak subjectivity checkpoint has been provided, it is used to inform which state to download and used for additional verification
    // otherwise, the 'finalized' state is downloaded and the state itself is used for verification (all trust delegated to the remote beacon node)
    if (!(args.weakSubjectivityServerUrl || Object.keys(weakSubjectivityServers).includes(args.network))) {
      throw new Error(
        `Missing weak subjectivity server URL.  Use either a custom URL via --weakSubjectivityServerUrl or use one of these options for --network: ${Object.keys(
          weakSubjectivityServers
        ).toString()}`
      );
    }

    let stateId = "finalized";
    let checkpoint: Checkpoint | undefined;
    if (args.weakSubjectivityCheckpoint) {
      checkpoint = getCheckpointFromArg(args.weakSubjectivityCheckpoint);
      stateId = (checkpoint.epoch * SLOTS_PER_EPOCH).toString();
    }
    const wsState = await getWeakSubjectivityState(
      config,
      args,
      stateId,
      args.weakSubjectivityServerUrl || weakSubjectivityServers[args.network as WeakSubjectivityServer],
      logger
    );
    const store = lastDbState ?? wsState;
    return initAndVerifyWeakSubjectivityState(
      config,
      db,
      logger,
      store,
      wsState,
      checkpoint || getCheckpointFromState(config, wsState)
    );
  } else if (lastDbState) {
    // start the chain from the latest stored state in the db
    return await initStateFromAnchorState(config, db, logger, lastDbState);
  } else {
    const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
    if (genesisStateFile && !args.forceGenesis) {
      const stateBytes = await downloadOrLoadFile(genesisStateFile);
      const anchorState = getStateTypeFromBytes(config, stateBytes).createTreeBackedFromBytes(stateBytes);
      return await initStateFromAnchorState(config, db, logger, anchorState);
    } else {
      return await initStateFromEth1(config, db, logger, new Eth1Provider(config, options.eth1), signal);
    }
  }
}
