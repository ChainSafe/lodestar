import {
  DbCPStateDatastore,
  FileCPStateDatastore,
  IBeaconDb,
  checkAndPersistAnchorState,
  getStateTypeFromBytes,
} from "@lodestar/beacon-node";
import {BeaconConfig, ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {
  BeaconStateAllForks,
  computeAnchorCheckpoint,
  computeEpochAtSlot,
  ensureWithinWeakSubjectivityPeriod,
  isWithinWeakSubjectivityPeriod,
  loadState,
  loadStateAndValidators,
} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {Checkpoint} from "@lodestar/types/phase0";
import {Logger, formatBytes, toRootHex} from "@lodestar/utils";
import {
  fetchWeakSubjectivityState,
  getCheckpointFromArg,
  getCheckpointFromState,
  getGenesisFileUrl,
  getGenesisStateRoot,
} from "../../networks/index.js";
import {GlobalArgs, defaultNetwork} from "../../options/globalOptions.js";
import {downloadOrLoadFile, wrapFnError} from "../../util/index.js";
import {BeaconArgs} from "./options.js";

type StateWithBytes = {state: BeaconStateAllForks; stateBytes: Uint8Array};

async function initAndVerifyWeakSubjectivityState(
  config: BeaconConfig,
  db: IBeaconDb,
  logger: Logger,
  dbStateBytes: StateWithBytes,
  wsStateBytes: StateWithBytes,
  isWsStateFinalized: boolean,
  wsCheckpoint: Checkpoint,
  opts: {forceCheckpointSync?: boolean; ignoreWeakSubjectivityCheck?: boolean} = {}
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint: Checkpoint}> {
  const dbState = dbStateBytes.state;
  const wsState = wsStateBytes.state;
  // Check if the store's state and wsState are compatible
  if (
    dbState.genesisTime !== wsState.genesisTime ||
    !ssz.Root.equals(dbState.genesisValidatorsRoot, wsState.genesisValidatorsRoot)
  ) {
    throw new Error(
      "Db state and checkpoint state are not compatible, either clear the db or verify your checkpoint source"
    );
  }

  // Pick the state which is ahead as an anchor to initialize the beacon chain
  let anchorState = wsStateBytes;
  let anchorCheckpoint = wsCheckpoint;
  let isCheckpointState = true;
  if (dbState.slot > wsState.slot && !opts.forceCheckpointSync) {
    anchorState = dbStateBytes;
    anchorCheckpoint = getCheckpointFromState(dbState);
    isCheckpointState = false;
    logger.verbose(
      "Db state is ahead of the provided checkpoint state, using the db state to initialize the beacon chain"
    );
  }

  // Throw error unless user explicitly asked not to, in testnets can happen that wss period is too small
  // that even some epochs of non finalization can cause finalized checkpoint to be out of valid range
  const wssCheck = wrapFnError(() => ensureWithinWeakSubjectivityPeriod(config, anchorState.state, anchorCheckpoint));
  const isWithinWeakSubjectivityPeriod = wssCheck.err === null;
  if (!isWithinWeakSubjectivityPeriod && !opts.ignoreWeakSubjectivityCheck) {
    throw wssCheck.err;
  }

  if (isWsStateFinalized) {
    await checkAndPersistAnchorState(config, db, logger, anchorState.state, anchorState.stateBytes, {
      isWithinWeakSubjectivityPeriod,
      isCheckpointState,
    });
  }

  // Return the latest anchorState but still return original wsCheckpoint to validate in backfill
  return {anchorState: anchorState.state, wsCheckpoint};
}

/**
 * Initialize a beacon state, picking the strategy based on the `IBeaconArgs`
 *
 * State is initialized in one of three ways:
 * 1. restore from weak subjectivity state (possibly downloaded from a remote beacon node)
 * 2. restore from db
 * 3. restore from genesis state (possibly downloaded via URL)
 *
 * The returned anchorState could be finalized or not.
 * - if we load from checkpointState, checkpointSyncUrl, genesisStateFile or archived db, it is finalized
 * - it's not finalized if we load from unsafeCheckpointState or lastPersistedCheckpointState
 */
export async function initBeaconState(
  args: BeaconArgs & GlobalArgs,
  dataDir: string,
  chainForkConfig: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger
): Promise<{anchorState: BeaconStateAllForks; isFinalized: boolean; wsCheckpoint?: Checkpoint}> {
  if (args.forceCheckpointSync && !(args.checkpointState || args.checkpointSyncUrl || args.unsafeCheckpointState)) {
    throw new Error("Forced checkpoint sync without specifying a checkpointState or checkpointSyncUrl");
  }
  // fetch the latest state stored in the db which will be used in all cases, if it exists, either
  //   i)  used directly as the anchor state
  //   ii) used to load and verify a weak subjectivity state,
  const lastDbSlot = await db.stateArchive.lastKey();
  let stateBytes = lastDbSlot !== null ? await db.stateArchive.getBinary(lastDbSlot) : null;
  // Convert to `Uint8Array` to avoid unexpected behavior such as `Buffer.prototype.slice` not copying memory
  stateBytes = stateBytes ? new Uint8Array(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength) : null;
  let lastDbState: BeaconStateAllForks | null = null;
  let lastDbValidatorsBytes: Uint8Array | null = null;
  let lastDbStateWithBytes: StateWithBytes | null = null;
  if (stateBytes) {
    logger.verbose("Found the last archived state", {slot: lastDbSlot, size: formatBytes(stateBytes.length)});
    const {state, validatorsBytes} = loadStateAndValidators(chainForkConfig, stateBytes);
    lastDbState = state;
    lastDbValidatorsBytes = validatorsBytes;
    lastDbStateWithBytes = {state, stateBytes: stateBytes};
  }

  if (lastDbState) {
    // state from archive db is finalized
    const isFinalized = true;
    const config = createBeaconConfig(chainForkConfig, lastDbState.genesisValidatorsRoot);
    const wssCheck = isWithinWeakSubjectivityPeriod(config, lastDbState, getCheckpointFromState(lastDbState));

    // Explicitly force syncing from checkpoint state
    if (args.forceCheckpointSync) {
      // Forcing to sync from checkpoint is only recommended if node is taking too long to sync from last db state.
      // It is important to remind the user to remove this flag again unless it is absolutely necessary.
      if (wssCheck) {
        logger.warn(
          `Forced syncing from checkpoint even though db state at slot ${lastDbState.slot} is within weak subjectivity period`
        );
        logger.warn("Please consider removing --forceCheckpointSync flag unless absolutely necessary");
      }
    } else {
      // All cases when we want to directly use lastDbState as the anchor state:
      //  - if no checkpoint sync args provided, or
      //  - the lastDbState is within weak subjectivity period:
      if (
        (!args.checkpointState &&
          !args.checkpointSyncUrl &&
          !args.unsafeCheckpointState &&
          !args.lastPersistedCheckpointState) ||
        wssCheck
      ) {
        if (stateBytes === null) {
          // this never happens
          throw Error(`There is no stateBytes for the lastDbState at slot ${lastDbState.slot}`);
        }
        await checkAndPersistAnchorState(config, db, logger, lastDbState, stateBytes, {
          isWithinWeakSubjectivityPeriod: wssCheck,
          isCheckpointState: false,
        });
        logger.info("Initialized state from db", {
          slot: lastDbState.slot,
          epoch: computeEpochAtSlot(lastDbState.slot),
          stateRoot: toRootHex(lastDbState.hashTreeRoot()),
          isFinalized,
        });
        return {anchorState: lastDbState, isFinalized};
      }
    }
  }

  // See if we can sync state using checkpoint sync args or else start from genesis
  if (args.checkpointState) {
    // state is trusted to be finalized
    const isFinalized = true;
    logger.info("Loading checkpoint state", {checkpointState: args.checkpointState});
    const stateBytes = await downloadOrLoadFile(args.checkpointState);
    logger.info("Loaded checkpoint state", {
      size: formatBytes(stateBytes.length),
    });

    const stateAndCp = await readWSState(
      lastDbStateWithBytes,
      lastDbValidatorsBytes,
      {
        stateBytes,
        isFinalized,
        wssCheckpoint: args.wssCheckpoint,
        forceCheckpointSync: args.forceCheckpointSync,
        ignoreWeakSubjectivityCheck: args.ignoreWeakSubjectivityCheck,
      },
      chainForkConfig,
      db,
      logger
    );

    const {checkpoint} = computeAnchorCheckpoint(chainForkConfig, stateAndCp.anchorState);

    logger.info("Initialized checkpoint state", {
      slot: stateAndCp.anchorState.slot,
      epoch: checkpoint.epoch,
      checkpointRoot: toRootHex(checkpoint.root),
      isFinalized,
    });

    return {...stateAndCp, isFinalized};
  }

  if (args.checkpointSyncUrl) {
    // state is trusted to be finalized
    const isFinalized = true;
    const stateAndCp = await fetchWSStateFromBeaconApi(
      lastDbStateWithBytes,
      lastDbValidatorsBytes,
      {
        checkpointSyncUrl: args.checkpointSyncUrl,
        wssCheckpoint: args.wssCheckpoint,
        forceCheckpointSync: args.forceCheckpointSync,
        ignoreWeakSubjectivityCheck: args.ignoreWeakSubjectivityCheck,
      },
      chainForkConfig,
      db,
      logger
    );

    const {checkpoint} = computeAnchorCheckpoint(chainForkConfig, stateAndCp.anchorState);

    logger.info("Initialized checkpoint state", {
      slot: stateAndCp.anchorState.slot,
      epoch: checkpoint.epoch,
      checkpointRoot: toRootHex(checkpoint.root),
      isFinalized,
    });

    return {...stateAndCp, isFinalized};
  }

  if (args.unsafeCheckpointState || args.lastPersistedCheckpointState) {
    // state is supposed to be not yet finalized
    const isFinalized = false;
    let stateBytes: Uint8Array | null = null;
    // prioritize lastPersistedCheckpointState over unsafeCheckpointState, unless forceCheckpointSync is set
    if (args.lastPersistedCheckpointState && !args.forceCheckpointSync) {
      // find the last persisted checkpoint state to load
      const cpDataStore = args["chain.nHistoricalStatesFileDataStore"]
        ? new FileCPStateDatastore(dataDir)
        : new DbCPStateDatastore(db);
      logger.verbose(`Finding last persisted checkpoint state from ${cpDataStore.constructor.name}`);
      stateBytes = await cpDataStore.readLatestSafe();
      if (stateBytes === null) {
        logger.warn("Last persisted checkpoint state not found");
      } else {
        logger.info("Found last persisted checkpoint state", {size: formatBytes(stateBytes.length)});
      }
    }

    if (stateBytes === null && args.unsafeCheckpointState) {
      logger.info("Loading checkpoint state", {unsafeCheckpointState: args.unsafeCheckpointState});
      stateBytes = await downloadOrLoadFile(args.unsafeCheckpointState);
      logger.info("Loaded checkpoint state", {
        size: formatBytes(stateBytes.length),
      });
    }

    if (stateBytes !== null) {
      logger.warn(
        "Initializing from unfinalized checkpoint state is unsafe and may cause the node to follow a minority chain"
      );
      const stateAndCp = await readWSState(
        lastDbStateWithBytes,
        lastDbValidatorsBytes,
        {
          stateBytes,
          isFinalized,
          wssCheckpoint: args.wssCheckpoint,
          forceCheckpointSync: args.forceCheckpointSync,
          ignoreWeakSubjectivityCheck: args.ignoreWeakSubjectivityCheck,
        },
        chainForkConfig,
        db,
        logger
      );

      const lastProcessedSlot = stateAndCp.anchorState.latestBlockHeader.slot;
      const {checkpoint} = computeAnchorCheckpoint(chainForkConfig, stateAndCp.anchorState);

      logger.info("Initialized checkpoint state", {
        slot: stateAndCp.anchorState.slot,
        epoch: checkpoint.epoch,
        checkpointRoot: toRootHex(checkpoint.root),
        lastProcessedSlot,
        isFinalized,
      });

      return {...stateAndCp, isFinalized};
    }
  }

  const genesisStateFile = args.genesisStateFile || getGenesisFileUrl(args.network || defaultNetwork);
  if (genesisStateFile && !args.forceGenesis) {
    // genesis state is considered finalized
    const isFinalized = true;
    logger.info("Loading genesis state", {genesisStateFile});
    let stateBytes = await downloadOrLoadFile(genesisStateFile);
    logger.info("Loaded genesis state", {size: formatBytes(stateBytes.length)});
    // Convert to `Uint8Array` to avoid unexpected behavior such as `Buffer.prototype.slice` not copying memory
    stateBytes = new Uint8Array(stateBytes.buffer, stateBytes.byteOffset, stateBytes.byteLength);
    const anchorState = getStateTypeFromBytes(chainForkConfig, stateBytes).deserializeToViewDU(stateBytes);
    // Validate genesis state root
    const stateRoot = toRootHex(anchorState.hashTreeRoot());
    const expectedRoot = getGenesisStateRoot(args.network);
    if (expectedRoot !== null && stateRoot !== expectedRoot) {
      throw Error(`Genesis state root mismatch expected=${expectedRoot} received=${stateRoot}`);
    }
    const config = createBeaconConfig(chainForkConfig, anchorState.genesisValidatorsRoot);
    const wssCheck = isWithinWeakSubjectivityPeriod(config, anchorState, getCheckpointFromState(anchorState));
    await checkAndPersistAnchorState(config, db, logger, anchorState, stateBytes, {
      isWithinWeakSubjectivityPeriod: wssCheck,
      isCheckpointState: true,
    });
    logger.info("Initialized genesis state", {
      slot: anchorState.slot,
      stateRoot,
      isFinalized,
    });
    return {anchorState, isFinalized};
  }

  throw Error("Failed to initialize beacon state, please provide a genesis state file or use checkpoint sync");
}

async function readWSState(
  lastDbStateBytes: StateWithBytes | null,
  lastDbValidatorsBytes: Uint8Array | null,
  wssOpts: {
    stateBytes: Uint8Array;
    isFinalized: boolean;
    wssCheckpoint?: string;
    forceCheckpointSync?: boolean;
    ignoreWeakSubjectivityCheck?: boolean;
  },
  chainForkConfig: ChainForkConfig,
  db: IBeaconDb,
  logger: Logger
): Promise<{anchorState: BeaconStateAllForks; wsCheckpoint?: Checkpoint}> {
  // weak subjectivity sync from a provided state file:
  // if a weak subjectivity checkpoint has been provided, it is used for additional verification
  // otherwise, the state itself is used for verification (not bad, because the trusted state has been explicitly provided)
  const {stateBytes, isFinalized, wssCheckpoint, forceCheckpointSync, ignoreWeakSubjectivityCheck} = wssOpts;
  const lastDbState = lastDbStateBytes?.state ?? null;

  let wsState: BeaconStateAllForks;
  if (lastDbState && lastDbValidatorsBytes) {
    // use lastDbState to load wsState if possible to share the same state tree
    wsState = loadState(chainForkConfig, lastDbState, stateBytes, lastDbValidatorsBytes).state;
  } else {
    wsState = getStateTypeFromBytes(chainForkConfig, stateBytes).deserializeToViewDU(stateBytes);
  }
  const config = createBeaconConfig(chainForkConfig, wsState.genesisValidatorsRoot);
  const wsStateBytes = {state: wsState, stateBytes};
  const store = lastDbStateBytes ?? wsStateBytes;
  const checkpoint = wssCheckpoint ? getCheckpointFromArg(wssCheckpoint) : getCheckpointFromState(wsState);
  return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsStateBytes, isFinalized, checkpoint, {
    forceCheckpointSync,
    ignoreWeakSubjectivityCheck,
  });
}

async function fetchWSStateFromBeaconApi(
  lastDbStateBytes: StateWithBytes | null,
  lastDbValidatorsBytes: Uint8Array | null,
  wssOpts: {
    checkpointSyncUrl: string;
    wssCheckpoint?: string;
    forceCheckpointSync?: boolean;
    ignoreWeakSubjectivityCheck?: boolean;
  },
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

  const {wsState, wsStateBytes, wsCheckpoint} = await fetchWeakSubjectivityState(chainForkConfig, logger, wssOpts, {
    lastDbState: lastDbStateBytes?.state ?? null,
    lastDbValidatorsBytes,
  });

  const config = createBeaconConfig(chainForkConfig, wsState.genesisValidatorsRoot);
  const wsStateWithBytes = {state: wsState, stateBytes: wsStateBytes};
  const store = lastDbStateBytes ?? wsStateWithBytes;
  // a fetched ws state is trusted to be finalized
  const isFinalized = true;
  return initAndVerifyWeakSubjectivityState(config, db, logger, store, wsStateWithBytes, isFinalized, wsCheckpoint, {
    forceCheckpointSync: wssOpts.forceCheckpointSync,
    ignoreWeakSubjectivityCheck: wssOpts.ignoreWeakSubjectivityCheck,
  });
}
