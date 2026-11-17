import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {BeaconEngineCore} from "../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../../src/chain/beaconEngine/events.js";
import {BeaconEngineMode} from "../../../src/chain/beaconEngine/options.js";
import {BeaconEngine} from "../../../src/chain/beaconEngine.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {ExecutionEngineState} from "../../../src/execution/engine/interface.js";
import {RangeSyncStatus} from "../../../src/sync/range/range.js";
import {BeaconSync} from "../../../src/sync/sync.js";
import {SerializedCache} from "../../../src/util/serializedCache.js";
import {ClockStopped} from "../../mocks/clock.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe.each([BeaconEngineMode.MainThread, BeaconEngineMode.Worker])("BeaconSync.getSyncStatus (%s)", (mode) => {
  let sync: BeaconSync;
  let core: BeaconEngineCore;
  let viewHead: ReturnType<typeof generateProtoBlock>;
  const head = generateProtoBlock({slot: 100, executionStatus: ExecutionStatus.Syncing});
  const clock = new ClockStopped(105);
  const executionEngine = {state: ExecutionEngineState.ONLINE};
  const rangeSync = {state: {status: RangeSyncStatus.Idle}};

  beforeEach(() => {
    head.slot = 100;
    head.executionStatus = ExecutionStatus.Syncing;
    viewHead = head;
    clock.setSlot(105);
    executionEngine.state = ExecutionEngineState.ONLINE;
    rangeSync.state.status = RangeSyncStatus.Idle;
    core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
      forkChoice: {getHead: () => head},
      emitter: new BeaconEngineEventBus(),
    });
    const beaconEngine = new BeaconEngine({
      core,
      config: createBeaconConfig({}, new Uint8Array(32)),
      clock,
      emitter: new ChainEventEmitter(),
      serializedCache: new SerializedCache(),
      ...(mode === BeaconEngineMode.Worker ? {coreEmitter: core.emitter} : {}),
    });
    Object.assign(beaconEngine, {chainView: {getHead: () => viewHead}});
    sync = Object.assign(Object.create(BeaconSync.prototype) as BeaconSync, {
      chain: {clock, executionEngine, beaconEngine},
      opts: {},
      slotImportTolerance: 32,
      network: {getConnectedPeerCount: () => 1},
      rangeSync,
    });
  });

  it("pulls current head optimism even when sync control is already synced", async () => {
    expect(sync.isSynced()).toBe(true);
    expect(await sync.getSyncStatus()).toEqual({
      headSlot: 100,
      syncDistance: 0,
      isSyncing: false,
      isOptimistic: true,
      elOffline: false,
    });
    head.executionStatus = ExecutionStatus.Valid;
    expect((await sync.getSyncStatus()).isOptimistic).toBe(false);
  });

  it.each([RangeSyncStatus.Head, RangeSyncStatus.Finalized, RangeSyncStatus.Idle])(
    "preserves progress reporting while range sync has status %s",
    async (status) => {
      head.slot = 10;
      rangeSync.state.status = status;
      expect(await sync.getSyncStatus()).toEqual({
        headSlot: 10,
        syncDistance: 95,
        isSyncing: true,
        isOptimistic: true,
        elOffline: false,
      });
    }
  );

  it.each([
    {viewSlot: 10, headSlot: 100, isOptimistic: false, isSyncing: false, syncDistance: 0},
    {viewSlot: 100, headSlot: 10, isOptimistic: true, isSyncing: true, syncDistance: 95},
  ])("reports one authoritative head when ChainView is at slot $viewSlot", async (expected) => {
    viewHead = generateProtoBlock({slot: expected.viewSlot, executionStatus: ExecutionStatus.Valid});
    head.slot = expected.headSlot;
    head.executionStatus = expected.isOptimistic ? ExecutionStatus.Syncing : ExecutionStatus.Valid;
    const read = vi.spyOn(core.forkChoice, "getHead");

    expect(await sync.getSyncStatus()).toEqual({
      headSlot: expected.headSlot,
      syncDistance: expected.syncDistance,
      isSyncing: expected.isSyncing,
      isOptimistic: expected.isOptimistic,
      elOffline: false,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(sync.isSynced()).toBe(expected.viewSlot === 100);
  });

  it.each([ExecutionEngineState.OFFLINE, ExecutionEngineState.AUTH_FAILED])(
    "preserves execution-client availability reporting for %s",
    async (state) => {
      executionEngine.state = state;
      expect((await sync.getSyncStatus()).elOffline).toBe(true);
    }
  );

  it("keeps the genesis response without requesting the head", async () => {
    clock.setSlot(0);
    const read = vi.spyOn(core.forkChoice, "getHead");
    expect(await sync.getSyncStatus()).toEqual({
      headSlot: 0,
      syncDistance: 0,
      isSyncing: false,
      isOptimistic: false,
      elOffline: false,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("propagates an engine read failure to the caller", async () => {
    const failure = Error("engine unavailable");
    vi.spyOn(core.forkChoice, "getHead").mockImplementationOnce(() => {
      throw failure;
    });
    await expect(sync.getSyncStatus()).rejects.toBe(failure);
  });
});
