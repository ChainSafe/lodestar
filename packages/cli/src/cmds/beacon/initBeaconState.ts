import {AbortSignal} from "@chainsafe/abort-controller";
import {ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {createIBeaconConfig, IBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {fromHex, ILogger} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconDb, IBeaconNodeOptions, initStateFromAnchorState, initStateFromEth1} from "@chainsafe/lodestar";
// eslint-disable-next-line no-restricted-imports
import {getStateTypeFromBytes} from "@chainsafe/lodestar/lib/util/multifork";
import {downloadOrLoadFile} from "../../util";
import {IBeaconArgs} from "./options";
import {defaultNetwork, IGlobalArgs} from "../../options/globalOptions";
import {fetchWeakSubjectivityState, getGenesisFileUrl, getInfuraBeaconUrl, infuraNetworks} from "../../networks";
import {Checkpoint} from "@chainsafe/lodestar-types/phase0";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

const checkpointRegex = new RegExp("^(?:0x)?([0-9a-f]{64}):([0-9]+)$");

function getCheckpointFromArg(checkpointStr: string): Checkpoint {
  const match = checkpointRegex.exec(checkpointStr.toLowerCase());
  if (!match) {
    throw new Error(`Could not parse checkpoint string: ${checkpointStr}`);
  }
  return {root: fromHex(match[1]), epoch: parseInt(match[2])};
}

function getCheckpointFromState(config: IChainForkConfig, state: allForks.BeaconState): Checkpoint {
  return {
    epoch: computeEpochAtSlot(state.latestBlockHeader.slot),
    root: allForks.getLatestBlockRoot(config, state),
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
  // Check if the store's state and wsState are compatible
  if (
    store.genesisTime !== wsState.genesisTime ||
    !ssz.Root.equals(store.genesisValidatorsRoot, wsState.genesisValidatorsRoot)
  ) {
    throw new Error(
      "Db state and checkpoint state are not compatible, either clear the db or verify your checkpoint source"
    );
  }

  // Pick the state which is ahead as an anchor to initialize the beacon chain
  let anchorState = wsState;
  let anchorCheckpoint = wsCheckpoint;
  if (store.slot > wsState.slot) {
    anchorState = store;
    anchorCheckpoint = getCheckpointFromState(config, store);
    logger.verbose(
      "Db state is ahead of the provided checkpoint state, using the db state to initialize the beacon chain"
    );
  }

  if (!allForks.isWithinWeakSubjectivityPeriod(config, anchorState, anchorCheckpoint)) {
    throw new Error("Fetched weak subjectivity checkpoint not within weak subjectivity period.");
  }

  return await initStateFromAnchorState(config, db, logger, anchorState);
}

/**
 * Initialize a beacon state, picking the strategy based on the `IBeaconArgs`
 *
 * State is initialized in one of three ways:
 * 1. restore from weak subjectivity state (possibly downloaded from a remote beacon node)
 * 2. restore from db
 * 3. restore from genesis state (possibly downloaded via URL)
 * 4. create genesis state from eth1
 */
export async function initBeaconState(
  options: IBeaconNodeOptions,
  args: IBeaconArgs & IGlobalArgs,
  chainForkConfig: IChainForkConfig,
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
    const wsState = getStateTypeFromBytes(chainForkConfig, stateBytes).createTreeBackedFromBytes(stateBytes);
    const config = createIBeaconConfig(chainForkConfig, wsState.genesisValidatorsRoot);
    const store = lastDbState ?? wsState;
    const checkpoint = args.weakSubjectivityCheckpoint
      ? getCheckpointFromArg(args.weakSubjectivityCheckpoint)
      : getCheckpointFromState(config, wsState);
    return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsState, checkpoint);
  } else if (args.weakSubjectivitySyncLatest) {
    // weak subjectivity sync from a state that needs to be fetched:
    // if a weak subjectivity checkpoint has been provided, it is used to inform which state to download and used for additional verification
    // otherwise, the 'finalized' state is downloaded and the state itself is used for verification (all trust delegated to the remote beacon node)
    const remoteBeaconUrl = args.weakSubjectivityServerUrl || getInfuraBeaconUrl(args.network);
    if (!remoteBeaconUrl) {
      throw new Error(
        `Missing weak subjectivity server URL.  Use either a custom URL via --weakSubjectivityServerUrl or use one of these options for --network: ${infuraNetworks.toString()}`
      );
    }

    let stateId = "finalized";
    let checkpoint: Checkpoint | undefined;
    if (args.weakSubjectivityCheckpoint) {
      checkpoint = getCheckpointFromArg(args.weakSubjectivityCheckpoint);
      stateId = (checkpoint.epoch * SLOTS_PER_EPOCH).toString();
    }
    const url = `${remoteBeaconUrl}/eth/v1/debug/beacon/states/${stateId}`;

    logger.info("Fetching weak subjectivity state from " + url);
    const wsState = await fetchWeakSubjectivityState(chainForkConfig, url);
    const config = createIBeaconConfig(chainForkConfig, wsState.genesisValidatorsRoot);
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
    const config = createIBeaconConfig(chainForkConfig, lastDbState.genesisValidatorsRoot);
    return await initStateFromAnchorState(config, db, logger, lastDbState);
  } else {
    const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
    if (genesisStateFile && !args.forceGenesis) {
      const stateBytes = await downloadOrLoadFile(genesisStateFile);
      const anchorState = getStateTypeFromBytes(chainForkConfig, stateBytes).createTreeBackedFromBytes(stateBytes);
      const config = createIBeaconConfig(chainForkConfig, anchorState.genesisValidatorsRoot);
      return await initStateFromAnchorState(config, db, logger, anchorState);
    } else {
      return await initStateFromEth1({config: chainForkConfig, db, logger, opts: options.eth1, signal});
    }
  }
}
