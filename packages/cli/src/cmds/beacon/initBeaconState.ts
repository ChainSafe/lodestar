import {ssz} from "@lodestar/types";
import {createIBeaconConfig, IBeaconConfig, IChainForkConfig} from "@lodestar/config";
import {ILogger} from "@lodestar/utils";
import {
  computeEpochAtSlot,
  getLatestBlockRoot,
  isWithinWeakSubjectivityPeriod,
  BeaconStateAllForks,
} from "@lodestar/state-transition";
import {
  IBeaconDb,
  IBeaconNodeOptions,
  initStateFromAnchorState,
  initStateFromEth1,
  getStateTypeFromBytes,
} from "@lodestar/beacon-node";
import {Checkpoint} from "@lodestar/types/phase0";

import {downloadOrLoadFile} from "../../util/index.js";
import {defaultNetwork, IGlobalArgs} from "../../options/globalOptions.js";
import {fetchWeakSubjectivityState, getCheckpointFromArg, getGenesisFileUrl} from "../../networks/index.js";
import {IBeaconArgs} from "./options.js";

function getCheckpointFromState(state: BeaconStateAllForks): Checkpoint {
  return {
    epoch: computeEpochAtSlot(state.latestBlockHeader.slot),
    root: getLatestBlockRoot(state),
  };
}

async function initAndVerifyWeakSubjectivityState(
  config: IBeaconConfig,
  db: IBeaconDb,
  logger: ILogger,
  store: BeaconStateAllForks,
  wsState: BeaconStateAllForks,
  wsCheckpoint: Checkpoint
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint: Checkpoint}> {
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
    anchorCheckpoint = getCheckpointFromState(store);
    logger.verbose(
      "Db state is ahead of the provided checkpoint state, using the db state to initialize the beacon chain"
    );
  }

  if (!isWithinWeakSubjectivityPeriod(config, anchorState, anchorCheckpoint)) {
    throw new Error("Fetched weak subjectivity checkpoint not within weak subjectivity period.");
  }

  anchorState = await initStateFromAnchorState(config, db, logger, anchorState);

  // Return the latest anchorState but still return original wsCheckpoint to validate in backfill
  return {anchorState, wsCheckpoint};
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
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint?: Checkpoint}> {
  // fetch the latest state stored in the db
  // this will be used in all cases, if it exists, either used during verification of a weak subjectivity state, or used directly as the anchor state
  const lastDbState = await db.stateArchive.lastValue();

  if (args.checkpointState) {
    return await readWSState(
      lastDbState,
      {checkpointState: args.checkpointState, wssCheckpoint: args.wssCheckpoint},
      chainForkConfig,
      db,
      logger
    );
  } else if (args.checkpointSyncUrl) {
    return await fetchWSStateFromBeaconApi(lastDbState, args, chainForkConfig, db, logger);
  } else if (lastDbState) {
    // start the chain from the latest stored state in the db
    const config = createIBeaconConfig(chainForkConfig, lastDbState.genesisValidatorsRoot);
    const anchorState = await initStateFromAnchorState(config, db, logger, lastDbState);
    return {anchorState};
  } else {
    const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
    if (genesisStateFile && !args.forceGenesis) {
      const stateBytes = await downloadOrLoadFile(genesisStateFile);
      let anchorState = getStateTypeFromBytes(chainForkConfig, stateBytes).deserializeToViewDU(stateBytes);
      const config = createIBeaconConfig(chainForkConfig, anchorState.genesisValidatorsRoot);
      anchorState = await initStateFromAnchorState(config, db, logger, anchorState);
      return {anchorState};
    } else {
      const anchorState = await initStateFromEth1({config: chainForkConfig, db, logger, opts: options.eth1, signal});
      return {anchorState};
    }
  }
}

async function readWSState(
  lastDbState: BeaconStateAllForks | null,
  wssOpts: {checkpointState: string; wssCheckpoint?: string},
  chainForkConfig: IChainForkConfig,
  db: IBeaconDb,
  logger: ILogger
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint?: Checkpoint}> {
  // weak subjectivity sync from a provided state file:
  // if a weak subjectivity checkpoint has been provided, it is used for additional verification
  // otherwise, the state itself is used for verification (not bad, because the trusted state has been explicitly provided)
  const {checkpointState, wssCheckpoint} = wssOpts;

  const stateBytes = await downloadOrLoadFile(checkpointState);
  const wsState = getStateTypeFromBytes(chainForkConfig, stateBytes).deserializeToViewDU(stateBytes);
  const config = createIBeaconConfig(chainForkConfig, wsState.genesisValidatorsRoot);
  const store = lastDbState ?? wsState;
  const checkpoint = wssCheckpoint ? getCheckpointFromArg(wssCheckpoint) : getCheckpointFromState(wsState);
  return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsState, checkpoint);
}

async function fetchWSStateFromBeaconApi(
  lastDbState: BeaconStateAllForks | null,
  wssOpts: {checkpointSyncUrl: string; wssCheckpoint?: string},
  chainForkConfig: IChainForkConfig,
  db: IBeaconDb,
  logger: ILogger
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint?: Checkpoint}> {
  // weak subjectivity sync from a state that needs to be fetched:
  // if a weak subjectivity checkpoint has been provided, it is used to inform which state to download and used for additional verification
  // otherwise, the 'finalized' state is downloaded and the state itself is used for verification (all trust delegated to the remote beacon node)
  try {
    // Validate the weakSubjectivityServerUrl and only log the origin to mask the
    // username password credentials
    const wssUrl = new URL(wssOpts.checkpointSyncUrl);
    logger.info("Fetching weak subjectivity state", {
      weakSubjectivityServerUrl: wssUrl.origin,
    });
  } catch (e) {
    logger.error("Invalid", {checkpointSyncUrl: wssOpts.checkpointSyncUrl}, e as Error);
    throw e;
  }

  const {wsState, wsCheckpoint} = await fetchWeakSubjectivityState(chainForkConfig, logger, wssOpts);
  const config = createIBeaconConfig(chainForkConfig, wsState.genesisValidatorsRoot);
  const store = lastDbState ?? wsState;
  return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsState, wsCheckpoint);
}
