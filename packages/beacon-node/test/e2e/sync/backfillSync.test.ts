import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainConfig} from "@lodestar/config";
import {CheckpointWithHex} from "@lodestar/fork-choice";
import {TimestampFormatCode} from "@lodestar/logger";
import {LogLevel, TestLoggerOpts, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {toHex, toRootHex} from "@lodestar/utils";
import {ChainEvent} from "../../../src/chain/index.js";
import {waitForEvent} from "../../utils/events/resolver.js";
import {connect, onPeerConnect} from "../../utils/network.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

describe("sync / backfill sync", () => {
  // ~93s for node A to finalize epoch 3 with its head at slot 40, then node B has to sync, finalize past its
  // anchor and backfill
  vi.setConfig({testTimeout: 240_000});

  const validatorCount = 8;
  const FULU_FORK_EPOCH = 1;
  const GLOAS_FORK_EPOCH = 2;
  const SLOT_DURATION_MS = 2000;
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH,
    GLOAS_FORK_EPOCH,
    BLOB_SCHEDULE: [{EPOCH: 1, MAX_BLOBS_PER_BLOCK: 3}],
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("backfills blocks and envelopes to genesis after checkpoint sync", async () => {
    const genesisSlotsDelay = 4;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);

    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.debug,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: SLOT_DURATION_MS / 1000,
      },
    };
    const loggerNodeA = testLogger("BackfillSync-Node-A", testLoggerOpts);
    const loggerNodeB = testLogger("BackfillSync-Node-B", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        api: {rest: {enabled: false}},
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, useWorker: false},
        // The mock execution engine can't return the payloads to serve deduplicated envelopes
        chain: {blsVerifyAllMainThread: true, dedupePayloads: false},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeA,
    });
    afterEachCallbacks.push(() => bn.close());

    const {validators} = await getAndInitDevValidators({
      node: bn,
      logPrefix: "BackfillSyncVc",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });
    afterEachCallbacks.push(() => Promise.all(validators.map((validator) => validator.close())));

    const anchorEpoch = GLOAS_FORK_EPOCH + 1;
    const [finalizedCp] = await Promise.all([
      waitForEvent<CheckpointWithHex>(
        bn.chain.emitter,
        ChainEvent.forkChoiceFinalized,
        150_000,
        (finalized) => finalized.epoch === anchorEpoch
      ),
      waitForEvent<routes.events.EventData[routes.events.EventType.head]>(
        bn.chain.emitter,
        routes.events.EventType.head,
        150_000,
        ({slot}) => slot >= (anchorEpoch + 2) * SLOTS_PER_EPOCH
      ),
    ]);

    const finalizedStateRes = bn.chain.getStateByCheckpoint(finalizedCp);
    if (!finalizedStateRes) {
      throw Error("Node A finalized checkpoint state not available");
    }
    const anchorState = (finalizedStateRes.state as BeaconStateView).cachedState;
    const anchorSlot = anchorState.slot;

    const bn2 = await getDevBeaconNode({
      params: testParams,
      options: {
        api: {rest: {enabled: false}},
        network: {useWorker: false},
        chain: {blsVerifyAllMainThread: true},
        // every newPayload call returns SYNCING
        executionEngine: {mode: "mock", eth1BlockHash: "0x4242424242424242424242424242424242424242"},
      },
      validatorCount,
      genesisTime,
      logger: loggerNodeB,
      anchorState,
    });
    afterEachCallbacks.push(() => bn2.close());
    expect(bn2.chain.earliestAvailableSlot).toBe(anchorSlot);

    await Promise.all([connect(bn2.network, bn.network), onPeerConnect(bn2.network), onPeerConnect(bn.network)]);

    // Backfill starts once node B is synced and has archived blocks above its anchor
    const backfillDeadline = Date.now() + 90_000;
    while (bn2.chain.earliestAvailableSlot > 0) {
      if (Date.now() > backfillDeadline) {
        expect.fail(`Node B did not backfill to genesis, earliestAvailableSlot=${bn2.chain.earliestAvailableSlot}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(await bn2.db.earliestAvailableSlot.get()).toBe(0);

    const {custodyColumns} = bn2.chain.custodyConfig;
    let blockCount = 0;
    let blocksWithColumns = 0;
    for (let slot = 0; slot <= anchorSlot; slot++) {
      const [blockA, blockB] = await Promise.all([
        bn.db.blockArchive.getBinary(slot),
        bn2.db.blockArchive.getBinary(slot),
      ]);
      expect(blockB && toHex(blockB), `block at slot ${slot}`).toBe(blockA && toHex(blockA));
      if (blockA) blockCount++;

      const blockRoot = await bn.db.blockArchive.getRootBySlot(slot);
      if (blockRoot !== null && slot >= FULU_FORK_EPOCH * SLOTS_PER_EPOCH && slot < anchorSlot) {
        const key = {slot, blockRoot: toRootHex(blockRoot)};
        const [columnsA, columnsB] = await Promise.all([
          bn.db.dataColumns.getManyBinary(key, custodyColumns),
          bn2.db.dataColumns.getManyBinary(key, custodyColumns),
        ]);
        expect(
          columnsB.map((column) => column && toHex(column)),
          `custody columns at slot ${slot}`
        ).toEqual(columnsA.map((column) => column && toHex(column)));
        if (columnsA.some((column) => column !== undefined)) blocksWithColumns++;
      }

      if (slot >= GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH && slot < anchorSlot) {
        const [envelopeA, envelopeB] = await Promise.all([
          bn.db.executionPayloadEnvelopeArchive.getBinary(slot),
          bn2.db.executionPayloadEnvelopeArchive.getBinary(slot),
        ]);
        expect(envelopeB !== null, `envelope at slot ${slot}`).toBe(envelopeA !== null);
      }
    }
    expect(blockCount).toBeGreaterThan(anchorSlot / 2);
    expect(blocksWithColumns).toBeGreaterThan(0);
  });
});
