import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {BeaconEngine} from "../../../src/chain/beaconEngine/beaconEngine.js";
import {BeaconEngineCore} from "../../../src/chain/beaconEngine/beaconEngineCore.js";
import {BeaconEngineEventBus} from "../../../src/chain/beaconEngine/events.js";
import {ChainEventEmitter} from "../../../src/chain/emitter.js";
import {ExecutionEngineState} from "../../../src/execution/engine/interface.js";
import {RangeSyncStatus} from "../../../src/sync/range/range.js";
import {BeaconSync} from "../../../src/sync/sync.js";
import {SerializedCache} from "../../../src/util/serializedCache.js";
import {ClockStopped} from "../../mocks/clock.js";
import {generateProtoBlock} from "../../utils/typeGenerator.js";

describe("BeaconSync.getSyncStatus", () => {
  let sync: BeaconSync;
  let core: BeaconEngineCore;
  const head = generateProtoBlock({slot: 100, executionStatus: ExecutionStatus.Syncing});
  const clock = new ClockStopped(105);
  const executionEngine = {state: ExecutionEngineState.ONLINE};
  const rangeSync = {state: {status: RangeSyncStatus.Idle}};

  beforeEach(() => {
    head.slot = 100;
    head.executionStatus = ExecutionStatus.Syncing;
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
    });
    Object.assign(beaconEngine, {chainView: {getHead: () => head}});
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

  it.each([ExecutionEngineState.OFFLINE, ExecutionEngineState.AUTH_FAILED])(
    "preserves execution-client availability reporting for %s",
    async (state) => {
      executionEngine.state = state;
      expect((await sync.getSyncStatus()).elOffline).toBe(true);
    }
  );

  it("keeps the genesis response without requesting head optimism", async () => {
    clock.setSlot(0);
    const read = vi.spyOn(core, "isHeadOptimistic");
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
    vi.spyOn(core, "isHeadOptimistic").mockImplementationOnce(() => {
      throw failure;
    });
    await expect(sync.getSyncStatus()).rejects.toBe(failure);
  });
});
