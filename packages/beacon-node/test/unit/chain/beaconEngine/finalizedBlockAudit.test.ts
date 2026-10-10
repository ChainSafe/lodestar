import {strict as assert} from "node:assert";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {CheckpointWithHex, ExecutionStatus, ProtoArray, ProtoBlock} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {LateCanonicalBlockReason} from "../../../../src/chain/beaconEngine/interface.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
import {createMetrics} from "../../../../src/metrics/index.js";
import {initDevState} from "../../../../src/node/utils/state.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {startIsolatedTmpBeaconDb} from "../../../utils/db.js";
import {createTestBeaconEngine} from "../../../utils/engine.js";

const root = (n: number) => toRootHex(Buffer.alloc(32, n));

describe("BeaconEngine finalized-block audit", () => {
  const config = createChainForkConfig(chainConfig);
  const logger = getMockedLogger();
  let engine: BeaconEngine;
  let closeDb: () => Promise<void>;
  let clock: ClockStopped;
  let protoArray: ProtoArray;
  let anchor: ProtoBlock;
  let head: ProtoBlock;
  let finalized: CheckpointWithHex;
  let metrics: ReturnType<typeof createMetrics>;

  beforeEach(async () => {
    const {db, close} = await startIsolatedTmpBeaconDb(config);
    closeDb = close;
    clock = new ClockStopped(0);
    metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
    const state = initDevState(config, 16, {genesisTime: 0});
    state.commit();
    ({beaconEngine: engine} = createTestBeaconEngine(
      {
        ...defaultChainOptions,
        blsVerifyAllMainThread: true,
        disableLightClientServer: true,
        disablePrepareNextSlot: true,
        disableArchiveOnCheckpoint: true,
      },
      {
        privateKey: await generateKeyPair("secp256k1"),
        config: createBeaconConfig(config, state.genesisValidatorsRoot),
        pubkeyCache,
        db,
        dbName: "test",
        dataDir: "test",
        logger,
        clock,
        processShutdownCallback: () => {},
        metrics,
        anchorStateBytes: state.serialize(),
        isAnchorStateFinalized: true,
        executionEngine: new ExecutionEngineDisabled(),
      }
    ));
    await engine.prepareAnchorState(state.serialize());
    await engine.initializeFromAnchor();
    finalized = engine.forkChoice.getFinalizedCheckpoint();
    anchor = {
      ...engine.forkChoice.getHead(),
      executionStatus: ExecutionStatus.Valid,
      executionPayloadBlockHash: root(100),
      executionPayloadNumber: 0,
      executionPayloadGasLimit: 30_000_000,
      importedTimely: false,
      timeliness: false,
    };
    head = anchor;
    protoArray = ProtoArray.initialize(anchor, 0);
    vi.spyOn(engine.forkChoice, "getFinalizedCheckpoint").mockImplementation(() => finalized);
    vi.spyOn(engine.forkChoice, "getHead").mockImplementation(() => head);
    vi.spyOn(engine.forkChoice, "getAllAncestorAndNonAncestorBlocksDefaultStatus").mockImplementation((blockRoot) => {
      const status = protoArray.getDefaultVariant(blockRoot);
      assert(status !== undefined);
      return protoArray.getAllAncestorAndNonAncestorNodes(blockRoot, status);
    });
    vi.spyOn(engine.forkChoice, "updateTime").mockImplementation(() => {});
    vi.spyOn(metrics.importBlock.lateCanonicalBlock, "inc");
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await engine.close();
    metrics.close();
    vi.restoreAllMocks();
    await closeDb();
  });

  function add(
    n: number,
    slot: number,
    parent: ProtoBlock,
    extra: Partial<Pick<ProtoBlock, "timeliness" | "importedTimely" | "parentBlockHash">> = {}
  ): ProtoBlock {
    protoArray.onBlock({...anchor, blockRoot: root(n), slot, parentRoot: parent.blockRoot, ...extra}, slot, null);
    const block = protoArray.nodes.at(-1);
    assert(block);
    return block;
  }

  function prepareFinality(block: ProtoBlock, epoch: number): void {
    finalized = {epoch, root: fromHex(block.blockRoot), rootHex: block.blockRoot};
    head = block;
    clock.setSlot(block.slot);
  }

  async function storeBlocks(...blocks: ProtoBlock[]): Promise<void> {
    for (const block of blocks) {
      const signed = ssz.phase0.SignedBeaconBlock.defaultValue();
      signed.message.slot = block.slot;
      signed.message.parentRoot = fromHex(block.parentRoot);
      await engine.db.block.putBinary(fromHex(block.blockRoot), ssz.phase0.SignedBeaconBlock.serialize(signed));
    }
  }

  async function canonicalBlocks(): Promise<ProtoBlock> {
    const slow = add(1, 8, anchor, {timeliness: true});
    const orphan = add(99, 9, anchor);
    const timely = add(2, 9, slow, {importedTimely: true, timeliness: true});
    const late = add(3, 10, timely);
    await storeBlocks(anchor, slow, orphan, timely, late);
    return late;
  }

  it("audits the engine's finalized canonical blocks only when migrating them", async () => {
    const block = await canonicalBlocks();
    prepareFinality(block, 1);
    engine.updateTime(clock.currentSlot);
    expect(metrics.importBlock.lateCanonicalBlock.inc).not.toHaveBeenCalled();

    expect(await engine.migrateCanonicalBlocks()).toEqual([0, 8, 9, 10]);
    expect(engine.forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus).toHaveBeenCalledWith(block.blockRoot);
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledTimes(2);
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledWith({
      reason: LateCanonicalBlockReason.SlowImport,
    });
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledWith({
      reason: LateCanonicalBlockReason.LateReceive,
    });
    expect(logger.verbose).toHaveBeenCalledWith(
      "Late imported canonical blocks",
      expect.objectContaining({
        finalizedEpoch: 1,
        finalizedRoot: block.blockRoot,
        count: 2,
        slowImport: 1,
        lateReceive: 1,
        slotRange: "[8, 10]",
      })
    );
    expect(await engine.db.block.getBinary(fromHex(root(99)))).not.toBeNull();
    expect(await engine.migrateCanonicalBlocks()).toEqual([]);
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledTimes(2);
  });

  it("excludes archived blocks even when fork choice retains all older nodes", async () => {
    const first = await canonicalBlocks();
    prepareFinality(first, 1);
    await engine.migrateCanonicalBlocks();
    const second = add(4, 16, first, {timeliness: true});
    await storeBlocks(second);
    prepareFinality(second, 2);
    expect(await engine.migrateCanonicalBlocks()).toEqual([16]);
    expect(protoArray.nodes[0].blockRoot).toBe(anchor.blockRoot);
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledTimes(3);
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenLastCalledWith({
      reason: LateCanonicalBlockReason.SlowImport,
    });
  });

  it("does not later count blocks migrated during sync", async () => {
    const first = await canonicalBlocks();
    prepareFinality(first, 1);
    clock.setSlot(first.slot + SLOTS_PER_EPOCH + 1);
    expect(await engine.migrateCanonicalBlocks()).toEqual([0, 8, 9, 10]);
    expect(metrics.importBlock.lateCanonicalBlock.inc).not.toHaveBeenCalled();
    const second = add(4, clock.currentSlot, first);
    await storeBlocks(second);
    prepareFinality(second, 2);
    await engine.migrateCanonicalBlocks();
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledExactlyOnceWith({
      reason: LateCanonicalBlockReason.LateReceive,
    });
  });

  it("does not audit again when an epoch advances with the same finalized root", async () => {
    const block = await canonicalBlocks();
    prepareFinality(block, 1);
    await engine.migrateCanonicalBlocks();
    prepareFinality(block, 2);
    await engine.migrateCanonicalBlocks();
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledTimes(2);
  });

  it("counts the finalized Gloas PENDING block and each canonical ancestor root once", async () => {
    const parent = add(1, 8, anchor, {parentBlockHash: root(100), timeliness: true});
    protoArray.onExecutionPayload(
      parent.blockRoot,
      parent.slot,
      root(101),
      1,
      30_000_000,
      null,
      ExecutionStatus.Valid,
      DataAvailabilityStatus.Available
    );
    const block = add(2, 16, parent, {parentBlockHash: root(101)});
    await storeBlocks(parent, block);
    prepareFinality(block, 2);
    expect(await engine.migrateCanonicalBlocks()).toEqual([8, 16]);
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledTimes(2);
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledWith({
      reason: LateCanonicalBlockReason.SlowImport,
    });
    expect(metrics.importBlock.lateCanonicalBlock.inc).toHaveBeenCalledWith({
      reason: LateCanonicalBlockReason.LateReceive,
    });
  });

  it("keeps the checkpoint snapshot when finality advances during migration", async () => {
    const first = await canonicalBlocks();
    const second = add(4, 16, first);
    await storeBlocks(second);
    prepareFinality(first, 1);
    const getBinary = engine.db.block.getBinary.bind(engine.db.block);
    vi.spyOn(engine.db.block, "getBinary").mockImplementationOnce(async (blockRoot) => {
      prepareFinality(second, 2);
      return getBinary(blockRoot);
    });
    expect(await engine.migrateCanonicalBlocks()).toEqual([0, 8, 9, 10]);
    expect(logger.verbose).toHaveBeenCalledWith(
      "Late imported canonical blocks",
      expect.objectContaining({finalizedEpoch: 1, finalizedRoot: first.blockRoot, count: 2})
    );
    expect(await engine.migrateCanonicalBlocks()).toEqual([16]);
    expect(logger.verbose).toHaveBeenCalledWith(
      "Late imported canonical blocks",
      expect.objectContaining({finalizedEpoch: 2, finalizedRoot: second.blockRoot, count: 1})
    );
  });

  it("does not fail migration if audit reporting fails", async () => {
    prepareFinality(await canonicalBlocks(), 1);
    const error = new Error("metric reporting failed");
    vi.mocked(metrics.importBlock.lateCanonicalBlock.inc).mockImplementation(() => {
      throw error;
    });
    expect(await engine.migrateCanonicalBlocks()).toEqual([0, 8, 9, 10]);
    expect(logger.error).toHaveBeenCalledWith("Error auditing late canonical blocks", expect.any(Object), error);
  });
});
