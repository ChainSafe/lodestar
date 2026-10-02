import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterAll, afterEach, beforeAll, describe, expect, it} from "vitest";
import {BeaconDb, DbCPStateDatastore, nodeUtils} from "@lodestar/beacon-node";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {LevelDbController} from "@lodestar/db/controller/level";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateAllForks, computeAnchorCheckpoint, computeWeakSubjectivityPeriod} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {initBeaconState} from "../../../src/cmds/beacon/initBeaconState.js";
import {BeaconArgs} from "../../../src/cmds/beacon/options.js";
import {StateInitializationErrorCode} from "../../../src/cmds/beacon/stateInitialization/errors.js";
import {GlobalArgs} from "../../../src/options/globalOptions.js";
import {getMockedLogger} from "../../utils/loggerMock.js";

type Fixture = {state: BeaconStateAllForks; bytes: Uint8Array; file: string};
type AnchorSummary = {slot: number; stateRoot: string; isFinalized: boolean};

describe("initBeaconState", () => {
  const config = createChainForkConfig({
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: Infinity,
  });
  const secondsPerEpoch = (config.SLOT_DURATION_MS / 1000) * SLOTS_PER_EPOCH;

  let fixturesDir: string;
  let genesis: Fixture;
  let dbFresh: Fixture;
  let dbStale: Fixture;
  let checkpointFresh: Fixture;
  let checkpointStale: Fixture;
  let checkpointOlder: Fixture;
  let persistedCheckpoint: Fixture;
  let otherNetwork: Fixture;
  let wrongForkVersion: Fixture;

  function toFixture(name: string, state: BeaconStateAllForks): Fixture {
    state.commit();
    const bytes = state.serialize();
    const file = path.join(fixturesDir, `${name}.ssz`);
    fs.writeFileSync(file, bytes);
    return {state, bytes, file};
  }

  function stateAtEpoch(name: string, epoch: number, mutate?: (state: BeaconStateAllForks) => void): Fixture {
    const state = genesis.state.clone();
    state.slot = epoch * SLOTS_PER_EPOCH;
    state.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
      slot: state.slot,
      proposerIndex: 0,
      parentRoot: new Uint8Array(32),
      stateRoot: new Uint8Array(32),
      bodyRoot: new Uint8Array(32).fill(epoch % 256),
    });
    mutate?.(state);
    return toFixture(name, state);
  }

  beforeAll(() => {
    fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), "init-beacon-state-"));
    const genesisState = nodeUtils.initDevState(config, 64, {genesisTime: 0});
    genesisState.commit();
    // Genesis time such that the current epoch is 3x the weak subjectivity period, making early states stale
    const wsPeriod = computeWeakSubjectivityPeriod(config, genesisState);
    const currentEpoch = 3 * wsPeriod;
    genesisState.genesisTime = Math.floor(Date.now() / 1000) - currentEpoch * secondsPerEpoch;
    genesis = toFixture("genesis", genesisState);

    dbFresh = stateAtEpoch("dbFresh", currentEpoch - 6);
    checkpointFresh = stateAtEpoch("checkpointFresh", currentEpoch - 2);
    persistedCheckpoint = stateAtEpoch("persistedCheckpoint", currentEpoch - 3);
    checkpointStale = stateAtEpoch("checkpointStale", currentEpoch - wsPeriod - 20);
    dbStale = stateAtEpoch("dbStale", currentEpoch - wsPeriod - 40);
    checkpointOlder = stateAtEpoch("checkpointOlder", currentEpoch - wsPeriod - 60);
    otherNetwork = stateAtEpoch("otherNetwork", currentEpoch - 2, (state) => {
      state.genesisValidatorsRoot = new Uint8Array(32).fill(1);
    });
    wrongForkVersion = stateAtEpoch("wrongForkVersion", currentEpoch - 2, (state) => {
      state.fork = ssz.phase0.Fork.toViewDU({...state.fork.toValue(), currentVersion: new Uint8Array([9, 9, 9, 9])});
    });
  }, 60_000);

  afterAll(() => {
    fs.rmSync(fixturesDir, {recursive: true, force: true});
  });

  const dbs: {db: BeaconDb; dir: string}[] = [];

  afterEach(async () => {
    for (const {db, dir} of dbs.splice(0)) {
      await db.close();
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  async function createDb(opts: {archived?: Fixture; persistedCheckpoint?: Fixture} = {}): Promise<BeaconDb> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "init-beacon-state-db-"));
    const logger = getMockedLogger();
    const controller = await LevelDbController.create({name: path.join(dir, "db")}, {metrics: null, logger});
    const db = new BeaconDb(config, controller, {dataColumnDir: path.join(dir, "data_columns"), logger});
    dbs.push({db, dir});
    if (opts.archived) {
      await db.stateArchive.putBinary(opts.archived.state.slot, opts.archived.bytes);
    }
    if (opts.persistedCheckpoint) {
      const {checkpoint} = computeAnchorCheckpoint(config, opts.persistedCheckpoint.state);
      await new DbCPStateDatastore(db).write(checkpoint, opts.persistedCheckpoint.bytes);
    }
    return db;
  }

  // Reduce the result to a summary, a failing assertion would otherwise try to print the whole state
  async function init(db: BeaconDb, args: Partial<BeaconArgs & GlobalArgs>): Promise<AnchorSummary> {
    const {anchorState, isFinalized} = await initBeaconState(
      {network: "dev", ...args} as BeaconArgs & GlobalArgs,
      fixturesDir,
      path.join(fixturesDir, "pubkeys"),
      config,
      db,
      getMockedLogger()
    );
    return {slot: anchorState.slot, stateRoot: toRootHex(anchorState.hashTreeRoot()), isFinalized};
  }

  function anchorOf(fixture: Fixture, isFinalized: boolean): AnchorSummary {
    return {slot: fixture.state.slot, stateRoot: toRootHex(fixture.state.hashTreeRoot()), isFinalized};
  }

  it("starts from genesis with empty db and persists genesis state and block", async () => {
    const db = await createDb();
    const result = await init(db, {genesisStateFile: genesis.file});

    expect(result).toEqual(anchorOf(genesis, true));
    expect(await db.stateArchive.keys()).toEqual([0]);
    expect(await db.blockArchive.keys()).toEqual([0]);
  });

  it("resumes from db within weak subjectivity period even if checkpoint source is set", async () => {
    const db = await createDb({archived: dbFresh});
    const result = await init(db, {checkpointState: checkpointFresh.file});

    expect(result).toEqual(anchorOf(dbFresh, true));
    expect(await db.stateArchive.keys()).toEqual([dbFresh.state.slot]);
  });

  it("starts from checkpoint state if db is outside weak subjectivity period", async () => {
    const db = await createDb({archived: dbStale});
    const result = await init(db, {checkpointState: checkpointFresh.file});

    expect(result).toEqual(anchorOf(checkpointFresh, true));
    expect(await db.stateArchive.keys()).toEqual([dbStale.state.slot, checkpointFresh.state.slot]);
  });

  it("starts from checkpoint state with forceCheckpointSync even if db is within weak subjectivity period", async () => {
    const db = await createDb({archived: dbFresh});
    const result = await init(db, {checkpointState: checkpointFresh.file, forceCheckpointSync: true});

    expect(result).toEqual(anchorOf(checkpointFresh, true));
    expect(await db.stateArchive.keys()).toEqual([dbFresh.state.slot, checkpointFresh.state.slot]);
  });

  it("resumes from db outside weak subjectivity period if no checkpoint source is set", async () => {
    const db = await createDb({archived: dbStale});
    const result = await init(db, {genesisStateFile: genesis.file});

    expect(result).toEqual(anchorOf(dbStale, true));
    expect(await db.stateArchive.keys()).toEqual([dbStale.state.slot]);
  });

  it("rejects checkpoint state outside weak subjectivity period unless ignoreWeakSubjectivityCheck is set", async () => {
    const db = await createDb();
    await expect(init(db, {checkpointState: checkpointStale.file})).rejects.toMatchObject({
      type: {code: StateInitializationErrorCode.STALE_CHECKPOINT},
    });
    expect(await db.stateArchive.keys()).toEqual([]);

    const result = await init(db, {checkpointState: checkpointStale.file, ignoreWeakSubjectivityCheck: true});
    expect(result).toEqual(anchorOf(checkpointStale, true));
    expect(await db.stateArchive.keys()).toEqual([checkpointStale.state.slot]);
  });

  it("rejects checkpoint state not matching wssCheckpoint even if ignoreWeakSubjectivityCheck is set", async () => {
    const db = await createDb();
    const {checkpoint} = computeAnchorCheckpoint(config, checkpointFresh.state);
    const mismatchingCheckpoint = `${toRootHex(new Uint8Array(32).fill(0xab))}:${checkpoint.epoch}`;

    await expect(
      init(db, {checkpointState: checkpointFresh.file, wssCheckpoint: mismatchingCheckpoint})
    ).rejects.toMatchObject({type: {code: StateInitializationErrorCode.CHECKPOINT_ROOT_MISMATCH}});
    await expect(
      init(db, {
        checkpointState: checkpointFresh.file,
        wssCheckpoint: mismatchingCheckpoint,
        ignoreWeakSubjectivityCheck: true,
      })
    ).rejects.toMatchObject({type: {code: StateInitializationErrorCode.CHECKPOINT_ROOT_MISMATCH}});
    expect(await db.stateArchive.keys()).toEqual([]);

    const result = await init(db, {
      checkpointState: checkpointFresh.file,
      wssCheckpoint: `${toRootHex(checkpoint.root)}:${checkpoint.epoch}`,
    });
    expect(result).toEqual(anchorOf(checkpointFresh, true));
  });

  it("rejects checkpoint state from a different network than db", async () => {
    const db = await createDb({archived: dbStale});
    await expect(init(db, {checkpointState: otherNetwork.file})).rejects.toMatchObject({
      type: {code: StateInitializationErrorCode.INCOMPATIBLE_GENESIS},
    });
    expect(await db.stateArchive.keys()).toEqual([dbStale.state.slot]);
  });

  it("starts from last persisted checkpoint state as unfinalized without archiving it", async () => {
    const db = await createDb({persistedCheckpoint});
    const result = await init(db, {lastPersistedCheckpointState: true, genesisStateFile: genesis.file});

    expect(result).toEqual(anchorOf(persistedCheckpoint, false));
    expect(await db.stateArchive.keys()).toEqual([]);
  });

  it("resumes from db instead of genesis if no checkpoint state was persisted", async () => {
    const db = await createDb({archived: dbStale});
    const result = await init(db, {lastPersistedCheckpointState: true, genesisStateFile: genesis.file});

    expect(result).toEqual(anchorOf(dbStale, true));
    expect(await db.stateArchive.keys()).toEqual([dbStale.state.slot]);
  });

  it("rejects unfinalized checkpoint state with fork version not matching config", async () => {
    const db = await createDb();
    await expect(init(db, {unsafeCheckpointState: wrongForkVersion.file})).rejects.toMatchObject({
      type: {code: StateInitializationErrorCode.ANCHOR_STATE_FORK_MISMATCH},
    });
  });

  it("resumes from db ahead of an older checkpoint state", async () => {
    const db = await createDb({archived: dbStale});
    const result = await init(db, {checkpointState: checkpointOlder.file, ignoreWeakSubjectivityCheck: true});

    expect(result).toEqual(anchorOf(dbStale, true));
    expect(await db.stateArchive.keys()).toEqual([dbStale.state.slot]);
  });

  it("rejects forceCheckpointSync without checkpoint source", async () => {
    const db = await createDb();
    await expect(init(db, {forceCheckpointSync: true})).rejects.toMatchObject({
      type: {code: StateInitializationErrorCode.INVALID_CHECKPOINT_SOURCE},
    });
  });
});
