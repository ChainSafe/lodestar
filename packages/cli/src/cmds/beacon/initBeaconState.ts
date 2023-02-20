import {ssz} from "@lodestar/types";
import {createBeaconConfig, BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {
  getLatestBlockRoot,
  isWithinWeakSubjectivityPeriod,
  BeaconStateAllForks,
  computeCheckpointEpochAtStateSlot,
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
import {defaultNetwork, GlobalArgs} from "../../options/globalOptions.js";
import {fetchWeakSubjectivityState, getCheckpointFromArg, getGenesisFileUrl} from "../../networks/index.js";
import {BeaconArgs} from "./options.js";

export function getCheckpointFromState(state: BeaconStateAllForks): Checkpoint {
  return {
    // the correct checkpoint is based on state's slot, its latestBlockHeader's slot's epoch can be
    // behind the state
    epoch: computeCheckpointEpochAtStateSlot(state.slot),
    root: getLatestBlockRoot(state),
  };
}

async function initAndVerifyWeakSubjectivityState(
  config: BeaconConfig,
  db: IBeaconDb,
  logger: Logger,
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
  let isCheckpointState = true;
  if (store.slot > wsState.slot) {
    anchorState = store;
    anchorCheckpoint = getCheckpointFromState(store);
    isCheckpointState = false;
    logger.verbose(
      "Db state is ahead of the provided checkpoint state, using the db state to initialize the beacon chain"
    );
  }

  // Instead of warning user of wss check failure, we throw because user explicity wants to use
  // the checkpoint sync
  if (!isWithinWeakSubjectivityPeriod(config, anchorState, anchorCheckpoint)) {
    throw new Error("Fetched weak subjectivity checkpoint not within weak subjectivity period.");
  }

  anchorState = await initStateFromAnchorState(config, db, logger, anchorState, {
    isWithinWeakSubjectivityPeriod: true,
    isCheckpointState,
  });

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
  args: BeaconArgs & GlobalArgs,
  chainForkConfig: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger,
  signal: AbortSignal
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint?: Checkpoint}> {
  // fetch the latest state stored in the db which will be used in all cases, if it exists, either
  //   i)  used directly as the anchor state
  //   ii) used during verification of a weak subjectivity state,
  const lastDbState = await db.stateArchive.lastValue();
  if (lastDbState) {
    const config = createBeaconConfig(chainForkConfig, lastDbState.genesisValidatorsRoot);
    const wssCheck = isWithinWeakSubjectivityPeriod(config, lastDbState, getCheckpointFromState(lastDbState));
    // All cases when we want to directly use lastDbState as the anchor state:
    //  - if no checkpoint sync args provided, or
    //  - the lastDbState is within weak subjectivity period:
    if ((!args.checkpointState && !args.checkpointSyncUrl) || wssCheck) {
      const anchorState = await initStateFromAnchorState(config, db, logger, lastDbState, {
        isWithinWeakSubjectivityPeriod: wssCheck,
        isCheckpointState: false,
      });
      return {anchorState};
    }
  }

  // See if we can sync state using checkpoint sync args or else start from genesis
  if (args.checkpointState) {
    return readWSState(
      lastDbState,
      {checkpointState: args.checkpointState, wssCheckpoint: args.wssCheckpoint},
      chainForkConfig,
      db,
      logger
    );
  } else if (args.checkpointSyncUrl) {
    return fetchWSStateFromBeaconApi(
      lastDbState,
      {checkpointSyncUrl: args.checkpointSyncUrl, wssCheckpoint: args.wssCheckpoint},
      chainForkConfig,
      db,
      logger
    );
  } else {
    const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
    if (genesisStateFile && !args.forceGenesis) {
      const stateBytes = await downloadOrLoadFile(genesisStateFile);
      let anchorState = getStateTypeFromBytes(chainForkConfig, stateBytes).deserializeToViewDU(stateBytes);
      const config = createBeaconConfig(chainForkConfig, anchorState.genesisValidatorsRoot);
      const wssCheck = isWithinWeakSubjectivityPeriod(config, anchorState, getCheckpointFromState(anchorState));
      anchorState = await initStateFromAnchorState(config, db, logger, anchorState, {
        isWithinWeakSubjectivityPeriod: wssCheck,
        isCheckpointState: true,
      });
      return {anchorState};
    } else {
      // Only place we will not bother checking isWithinWeakSubjectivityPeriod as forceGenesis passed by user
      const anchorState = await initStateFromEth1({config: chainForkConfig, db, logger, opts: options.eth1, signal});
      return {anchorState};
    }
  }
}

async function readWSState(
  lastDbState: BeaconStateAllForks | null,
  wssOpts: {checkpointState: string; wssCheckpoint?: string},
  chainForkConfig: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint?: Checkpoint}> {
  // weak subjectivity sync from a provided state file:
  // if a weak subjectivity checkpoint has been provided, it is used for additional verification
  // otherwise, the state itself is used for verification (not bad, because the trusted state has been explicitly provided)
  const {checkpointState, wssCheckpoint} = wssOpts;

  const stateBytes = await downloadOrLoadFile(checkpointState);
  const wsState = getStateTypeFromBytes(chainForkConfig, stateBytes).deserializeToViewDU(stateBytes);
  const config = createBeaconConfig(chainForkConfig, wsState.genesisValidatorsRoot);
  const store = lastDbState ?? wsState;
  const checkpoint = wssCheckpoint ? getCheckpointFromArg(wssCheckpoint) : getCheckpointFromState(wsState);
  return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsState, checkpoint);
}

async function fetchWSStateFromBeaconApi(
  lastDbState: BeaconStateAllForks | null,
  wssOpts: {checkpointSyncUrl: string; wssCheckpoint?: string},
  chainForkConfig: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint?: Checkpoint}> {
  // weak subjectivity sync from a state that needs to be fetched:
  // if a weak subjectivity checkpoint has been provided, it is used to inform which state to download and used for additional verification
  // otherwise, the 'finalized' state is downloaded and the state itself is used for verification (all trust delegated to the remote beacon node)
  try {
    // Validate the weakSubjectivityServerUrl and only log the origin to mask the
    // username password credentials
    const checkpointSyncUrl = new URL(wssOpts.checkpointSyncUrl);
    logger.info("Fetching checkpoint state", {
      checkpointSyncUrl: checkpointSyncUrl.origin,
    });
  } catch (e) {
    logger.error("Invalid", {checkpointSyncUrl: wssOpts.checkpointSyncUrl}, e as Error);
    throw e;
  }

  const {wsState, wsCheckpoint} = await fetchWeakSubjectivityState(chainForkConfig, logger, wssOpts);
  const config = createBeaconConfig(chainForkConfig, wsState.genesisValidatorsRoot);
  const store = lastDbState ?? wsState;
  return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsState, wsCheckpoint);
}
