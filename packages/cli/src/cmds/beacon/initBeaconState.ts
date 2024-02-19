import {ssz} from "@lodestar/types";
import {createBeaconConfig, BeaconConfig, ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {
  isWithinWeakSubjectivityPeriod,
  ensureWithinWeakSubjectivityPeriod,
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

import {downloadOrLoadFile, wrapFnError} from "../../util/index.js";
import {defaultNetwork, GlobalArgs} from "../../options/globalOptions.js";
import {
  fetchWeakSubjectivityState,
  getCheckpointFromArg,
  getGenesisFileUrl,
  getCheckpointFromState,
} from "../../networks/index.js";
import {BeaconArgs} from "./options.js";

async function initAndVerifyWeakSubjectivityState(
  config: BeaconConfig,
  db: IBeaconDb,
  logger: Logger,
  store: BeaconStateAllForks,
  wsState: BeaconStateAllForks,
  wsCheckpoint: Checkpoint,
  opts: {ignoreWeakSubjectivityCheck?: boolean} = {}
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

  // Throw error unless user explicitly asked not to, in testnets can happen that wss period is too small
  // that even some epochs of non finalization can cause finalized checkpoint to be out of valid range
  const wssCheck = wrapFnError(() => ensureWithinWeakSubjectivityPeriod(config, anchorState, anchorCheckpoint));
  if (wssCheck.err !== null && opts.ignoreWeakSubjectivityCheck !== true) {
    throw wssCheck.err;
  }

  anchorState = await initStateFromAnchorState(config, db, logger, anchorState, {
    isWithinWeakSubjectivityPeriod: wssCheck.err === null ? true : false,
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
  if (args.forceCheckpointSync && !(args.checkpointState || args.checkpointSyncUrl)) {
    throw new Error("Forced checkpoint sync without specifying a checkpointState or checkpointSyncUrl");
  }
  // fetch the latest state stored in the db which will be used in all cases, if it exists, either
  //   i)  used directly as the anchor state
  //   ii) used during verification of a weak subjectivity state,
  const lastDbState = await db.stateArchive.lastValue();
  if (lastDbState) {
    const config = createBeaconConfig(chainForkConfig, lastDbState.genesisValidatorsRoot);
    const wssCheck = isWithinWeakSubjectivityPeriod(config, lastDbState, getCheckpointFromState(lastDbState));

    // Explicitly force syncing from checkpoint state
    if (args.forceCheckpointSync) {
      // Forcing to sync from checkpoint is only recommended if node is taking too long to sync from last db state.
      // It is important to remind the user to remove this flag again unless it is absolutely necessary.
      if (wssCheck) {
        logger.warn("Forced syncing from checkpoint even though db state is within weak subjectivity period");
        logger.warn("Please consider removing --forceCheckpointSync flag unless absolutely necessary");
      }
    } else {
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
  }

  // See if we can sync state using checkpoint sync args or else start from genesis
  if (args.checkpointState) {
    return readWSState(
      lastDbState,
      {checkpointState: args.checkpointState, wssCheckpoint: args.wssCheckpoint},
      chainForkConfig,
      db,
      logger,
      {ignoreWeakSubjectivityCheck: args.ignoreWeakSubjectivityCheck}
    );
  } else if (args.checkpointSyncUrl) {
    return fetchWSStateFromBeaconApi(
      lastDbState,
      {checkpointSyncUrl: args.checkpointSyncUrl, wssCheckpoint: args.wssCheckpoint},
      chainForkConfig,
      db,
      logger,
      {ignoreWeakSubjectivityCheck: args.ignoreWeakSubjectivityCheck}
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
  logger: Logger,
  opts: {ignoreWeakSubjectivityCheck?: boolean} = {}
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
  return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsState, checkpoint, opts);
}

async function fetchWSStateFromBeaconApi(
  lastDbState: BeaconStateAllForks | null,
  wssOpts: {checkpointSyncUrl: string; wssCheckpoint?: string},
  chainForkConfig: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger,
  opts: {ignoreWeakSubjectivityCheck?: boolean} = {}
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
  return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsState, wsCheckpoint, opts);
}
