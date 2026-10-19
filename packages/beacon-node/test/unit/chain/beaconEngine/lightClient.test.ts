import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RespStatus} from "@lodestar/reqresp";
import {IBeaconStateViewAltair} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {getLightclientApi} from "../../../../src/api/impl/lightclient/index.js";
import {BeaconEngine} from "../../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEvent} from "../../../../src/chain/beaconEngine/events.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {GossipErrorCode} from "../../../../src/chain/errors/gossipValidation.js";
import {LightClientErrorCode, LightClientServerErrorCode} from "../../../../src/chain/errors/lightClientError.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {LightClientServer} from "../../../../src/chain/lightClient/index.js";
import {defaultChainOptions} from "../../../../src/chain/options.js";
import {IBeaconEngineDb} from "../../../../src/db/interface.js";
import {ExecutionEngineDisabled} from "../../../../src/execution/engine/disabled.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType, SequentialGossipHandler} from "../../../../src/network/gossip/interface.js";
import {getGossipHandlers} from "../../../../src/network/processor/gossipHandlers.js";
import {onLightClientBootstrap} from "../../../../src/network/reqresp/handlers/lightClientBootstrap.js";
import {onLightClientFinalityUpdate} from "../../../../src/network/reqresp/handlers/lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "../../../../src/network/reqresp/handlers/lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "../../../../src/network/reqresp/handlers/lightClientUpdatesByRange.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("BeaconEngineCore light client ownership", () => {
  const config = createBeaconConfig(
    {ALTAIR_FORK_EPOCH: 0, BELLATRIX_FORK_EPOCH: 0, CAPELLA_FORK_EPOCH: 1, DENEB_FORK_EPOCH: 2},
    Buffer.alloc(32)
  );
  const slot = 2 * SLOTS_PER_EPOCH - 1;
  const root = Buffer.alloc(32, 1);
  const committeeRoot = Buffer.alloc(32, 2);
  const witness = {
    witness: Array.from({length: 4}, () => Buffer.alloc(32)),
    currentSyncCommitteeRoot: committeeRoot,
    nextSyncCommitteeRoot: Buffer.alloc(32, 3),
  };
  const db = {
    bestLightClientUpdate: {get: vi.fn(), put: vi.fn().mockResolvedValue(undefined)},
    checkpointHeader: {get: vi.fn(), put: vi.fn().mockResolvedValue(undefined), batchDelete: vi.fn()},
    syncCommittee: {get: vi.fn(), has: vi.fn().mockResolvedValue(true)},
    syncCommitteeWitness: {get: vi.fn(), put: vi.fn().mockResolvedValue(undefined), batchDelete: vi.fn()},
  };
  const logger = getMockedLogger();
  let engine: BeaconEngineCore;
  let facade: BeaconEngine;
  let emitter: ChainEventEmitter;
  let server: LightClientServer;
  let clock: ClockStopped;
  let chain: IBeaconChain;

  function createEngine(disableLightClientServer = false): BeaconEngineCore {
    return new BeaconEngineCore({
      config,
      opts: {...defaultChainOptions, disableLightClientServer},
      logger,
      metricsEnabled: false,
      genesisTime: clock.genesisTime,
      clock,
      db: db as unknown as IBeaconEngineDb,
      dbName: "test",
      dataColumnDir: "test",
      pubkeyCache,
      cpStateDatastore: {write: vi.fn(), remove: vi.fn(), read: vi.fn(), readLatestSafe: vi.fn(), readKeys: vi.fn()},
      validatorMonitorOpts: null,
      isAnchorStateFinalized: true,
      executionEngine: new ExecutionEngineDisabled(),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    clock = new ClockStopped(slot + 1);
    clock.setMsIntoSlot(config.getSyncMessageDueMs(ForkName.capella) + 1000);
    engine = createEngine();
    emitter = new ChainEventEmitter();
    facade = new BeaconEngine({core: engine, emitter, clock});
    if (!engine.lightClientServer) throw Error("Expected an engine-owned light client server");
    server = engine.lightClientServer;
    chain = {beaconEngine: facade, opts: {}, config} as unknown as IBeaconChain;
    db.syncCommitteeWitness.get.mockResolvedValue(witness);
    db.syncCommittee.get.mockResolvedValue(ssz.altair.SyncCommittee.defaultValue());
    const header = ssz.capella.LightClientHeader.defaultValue();
    header.beacon.slot = slot;
    db.checkpointHeader.get.mockResolvedValue(header);
    const update = ssz.capella.LightClientUpdate.defaultValue();
    update.attestedHeader.beacon.slot = slot;
    update.signatureSlot = slot + 1;
    db.bestLightClientUpdate.get.mockResolvedValue(update);
  });

  afterEach(async () => {
    await facade.close();
    vi.restoreAllMocks();
  });

  it("serves bootstrap and period updates through REST and req/resp with the header fork", async () => {
    const api = getLightclientApi({chain, config});
    const bootstrap = await engine.getLightClientBootstrap(root);
    const update = await engine.getLightClientUpdate(0);
    expect(bootstrap.slot).toBe(slot);
    expect(update.slot).toBe(slot);
    expect(await api.getLightClientBootstrap({blockRoot: toRootHex(root)}, {returnBytes: true})).toEqual({
      data: bootstrap.data,
      meta: {version: ForkName.capella},
    });
    expect((await api.getLightClientBootstrap({blockRoot: toRootHex(root)})).data).toEqual(
      ssz.capella.LightClientBootstrap.deserialize(bootstrap.data)
    );
    expect(await api.getLightClientUpdatesByRange({startPeriod: 0, count: 1})).toEqual({
      data: [ssz.capella.LightClientUpdate.deserialize(update.data)],
      meta: {versions: [ForkName.capella]},
    });
    expect(await Array.fromAsync(onLightClientBootstrap(root, chain))).toEqual([
      {data: bootstrap.data, boundary: {fork: ForkName.capella, epoch: 1}},
    ]);
    expect(await Array.fromAsync(onLightClientUpdatesByRange({startPeriod: 0, count: 1}, chain))).toEqual([
      {data: update.data, boundary: {fork: ForkName.capella, epoch: 1}},
    ]);
  });

  it.each(["optimistic", "finality"] as const)(
    "detaches cached %s updates and preserves REST/reqresp fork context",
    async (kind) => {
      const type =
        kind === "optimistic" ? ssz.capella.LightClientOptimisticUpdate : ssz.capella.LightClientFinalityUpdate;
      const value = ssz.capella.LightClientFinalityUpdate.defaultValue();
      value.attestedHeader.beacon.slot = slot;
      value.signatureSlot = slot + 1;
      const get =
        kind === "optimistic"
          ? engine.getLightClientOptimisticUpdate.bind(engine)
          : engine.getLightClientFinalityUpdate.bind(engine);
      if (kind === "optimistic") vi.spyOn(server, "getOptimisticUpdate").mockReturnValue(value);
      else vi.spyOn(server, "getFinalityUpdate").mockReturnValue(value);
      const first = await get();
      if (!first) throw Error("Expected update");
      const original = first.data.slice();
      first.data.fill(0xff);
      expect((await get())?.data).toEqual(original);
      const api = getLightclientApi({chain, config});
      const apiGet = kind === "optimistic" ? api.getLightClientOptimisticUpdate : api.getLightClientFinalityUpdate;
      expect(await apiGet(undefined, {returnBytes: true})).toEqual({data: original, meta: {version: ForkName.capella}});
      expect((await apiGet()).data).toEqual(type.deserialize(original));
      const responses =
        kind === "optimistic" ? onLightClientOptimisticUpdate(chain) : onLightClientFinalityUpdate(chain);
      expect(await Array.fromAsync(responses)).toEqual([
        {data: original, boundary: {fork: ForkName.capella, epoch: 1}},
      ]);
    }
  );

  it("copies committee roots and prunes through the engine", async () => {
    const returnedRoot = await engine.getLightClientCommitteeRoot(0);
    returnedRoot.fill(0xff);
    expect(await engine.getLightClientCommitteeRoot(0)).toEqual(Uint8Array.from(committeeRoot));
    await engine.pruneLightClientNonCheckpointData([root]);
    expect(db.syncCommitteeWitness.batchDelete).toHaveBeenCalledExactlyOnceWith([root]);
    expect(db.checkpointHeader.batchDelete).toHaveBeenCalledExactlyOnceWith([root]);
  });

  it("preserves unavailable results and skips only leading gaps in range requests", async () => {
    expect(await engine.getLightClientOptimisticUpdate()).toBeNull();
    expect(await engine.getLightClientFinalityUpdate()).toBeNull();
    await expect(Array.fromAsync(onLightClientOptimisticUpdate(chain))).rejects.toMatchObject({
      status: RespStatus.RESOURCE_UNAVAILABLE,
    });
    db.syncCommitteeWitness.get.mockResolvedValueOnce(null);
    await expect(Array.fromAsync(onLightClientBootstrap(root, chain))).rejects.toMatchObject({
      status: RespStatus.RESOURCE_UNAVAILABLE,
    });
    const api = getLightclientApi({chain, config});
    const available = await db.bestLightClientUpdate.get();
    db.bestLightClientUpdate.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(available)
      .mockResolvedValueOnce(null);
    expect((await api.getLightClientUpdatesByRange({startPeriod: 1, count: 4})).data).toHaveLength(1);
    expect(db.bestLightClientUpdate.get.mock.calls.slice(-3)).toEqual([[1], [2], [3]]);
  });

  it("disables queries and makes pruning a no-op when the service is disabled", async () => {
    const disabled = createEngine(true);
    expect(disabled.lightClientServer).toBeUndefined();
    for (const [name, query] of Object.entries({
      bootstrap: () => disabled.getLightClientBootstrap(root),
      update: () => disabled.getLightClientUpdate(0),
      optimistic: () => disabled.getLightClientOptimisticUpdate(),
      finality: () => disabled.getLightClientFinalityUpdate(),
      committeeRoot: () => disabled.getLightClientCommitteeRoot(0),
    })) {
      await expect(query(), `disabled ${name} query`).rejects.toMatchObject({
        type: {code: LightClientServerErrorCode.DISABLED},
      });
    }
    await disabled.pruneLightClientNonCheckpointData([root]);
    expect(db.syncCommitteeWitness.batchDelete).not.toHaveBeenCalled();
    chain.opts.disableLightClientServer = true;
    await expect(
      getLightclientApi({chain, config}).getLightClientUpdatesByRange({startPeriod: 0, count: 0})
    ).rejects.toMatchObject({type: {code: LightClientServerErrorCode.DISABLED}});
    await disabled.close();
  });

  it.each(["optimistic", "finality"] as const)("returns typed %s gossip verdicts", async (kind) => {
    const value = ssz.capella.LightClientFinalityUpdate.defaultValue();
    value.attestedHeader.beacon.slot = slot;
    value.finalizedHeader.beacon.slot = slot - 1;
    value.signatureSlot = slot + 1;
    const gossipType =
      kind === "optimistic" ? GossipType.light_client_optimistic_update : GossipType.light_client_finality_update;
    const handler = getGossipHandlers({
      chain,
      config,
      logger,
      metrics: null,
      events: new NetworkEventBus(),
      core: {} as INetworkCore,
    })[gossipType] as SequentialGossipHandler<typeof gossipType>;
    const validate = (bytes: Uint8Array) =>
      handler({
        gossipData: {serializedData: bytes},
        peerIdStr: "peer",
        seenTimestampSec: 1,
        topic: {type: gossipType, boundary: {fork: ForkName.capella, epoch: 1}},
      });
    const type =
      kind === "optimistic" ? ssz.capella.LightClientOptimisticUpdate : ssz.capella.LightClientFinalityUpdate;
    const getter =
      kind === "optimistic" ? vi.spyOn(server, "getOptimisticUpdate") : vi.spyOn(server, "getFinalityUpdate");
    getter.mockReturnValue(value);
    expect(await validate(type.serialize(value))).toMatchObject({
      err: {
        status: "ignore",
        code:
          kind === "optimistic"
            ? LightClientErrorCode.OPTIMISTIC_UPDATE_ALREADY_FORWARDED
            : LightClientErrorCode.FINALITY_UPDATE_ALREADY_FORWARDED,
      },
    });
    expect(await validate(new Uint8Array(1))).toMatchObject({
      err: {status: "reject", code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE},
    });
    getter.mockImplementation(() => {
      throw Error("unexpected");
    });
    expect(await validate(type.serialize(value))).toMatchObject({
      err: {status: "ignore", code: "UNEXPECTED_ERROR"},
    });
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), {code: "UNEXPECTED_ERROR"}, expect.any(Error));
  });

  it("forwards serialized optimistic and finality updates through the facade", async () => {
    const optimistic = vi.fn();
    const finality = vi.fn();
    const optimisticNotification = vi.fn();
    const finalityNotification = vi.fn();
    engine.emitter.on(BeaconEngineEvent.lightClientOptimisticUpdate, optimisticNotification);
    engine.emitter.on(BeaconEngineEvent.lightClientFinalityUpdate, finalityNotification);
    emitter.on(routes.events.EventType.lightClientOptimisticUpdate, optimistic);
    emitter.on(routes.events.EventType.lightClientFinalityUpdate, finality);
    const finalizedHeader = ssz.capella.LightClientHeader.defaultValue();
    finalizedHeader.beacon.slot = SLOTS_PER_EPOCH;
    db.checkpointHeader.get.mockResolvedValue(finalizedHeader);
    const postState = {
      currentSyncCommittee: ssz.altair.SyncCommittee.defaultValue(),
      nextSyncCommittee: ssz.altair.SyncCommittee.defaultValue(),
      finalizedCheckpoint: {epoch: 1, root},
      getSyncCommitteesWitness: () => witness,
      getFinalizedRootProof: () => ssz.capella.LightClientFinalityUpdate.defaultValue().finalityBranch,
    } as unknown as IBeaconStateViewAltair;
    const parent = ssz.capella.BeaconBlock.defaultValue();
    parent.slot = slot - 1;
    server.onImportBlockHead(parent, postState, slot - 2);
    await vi.waitFor(() => expect(db.checkpointHeader.put).toHaveBeenCalledOnce());
    const block = ssz.capella.BeaconBlock.defaultValue();
    block.slot = slot;
    block.parentRoot = ssz.capella.BeaconBlock.hashTreeRoot(parent);
    block.body.syncAggregate.syncCommitteeBits.set(0, true);
    server.onImportBlockHead(block, postState, parent.slot);
    await vi.waitFor(() => expect(finality).toHaveBeenCalledOnce());
    expect(optimistic).toHaveBeenCalledExactlyOnceWith({
      version: ForkName.capella,
      data: expect.objectContaining({signatureSlot: slot}),
    });
    expect(finality).toHaveBeenCalledWith({
      version: ForkName.capella,
      data: expect.objectContaining({signatureSlot: slot, finalizedHeader}),
    });
    expect(optimisticNotification).toHaveBeenCalledExactlyOnceWith({
      data: ssz.capella.LightClientOptimisticUpdate.serialize(optimistic.mock.calls[0][0].data),
      slot: parent.slot,
    });
    expect(finalityNotification).toHaveBeenCalledExactlyOnceWith({
      data: ssz.capella.LightClientFinalityUpdate.serialize(finality.mock.calls[0][0].data),
      slot: parent.slot,
    });
    expect(optimistic.mock.calls[0][0].data.syncAggregate.syncCommitteeBits.get(0)).toBe(true);
    optimistic.mock.calls[0][0].data.syncAggregate.syncCommitteeBits.set(0, false);
    expect(server.getOptimisticUpdate()?.syncAggregate.syncCommitteeBits.get(0)).toBe(true);
  });
});
