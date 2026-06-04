import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {Mocked, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {toHex} from "@lodestar/utils";
import {BlockDutiesService} from "../../../src/services/blockDuties.js";
import {ChainHeaderTracker, HeadEventData} from "../../../src/services/chainHeaderTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {loggerVc} from "../../utils/logger.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

vi.mock("../../../src/services/chainHeaderTracker.js");

describe("BlockDutiesService", () => {
  const api = getApiClientStub();
  const preFuluConfig = createChainForkConfig(defaultConfig);
  const postFuluConfig = getConfig(ForkName.fulu);
  let validatorStore: ValidatorStore;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  // @ts-expect-error - Mocked class don't need parameters
  const chainHeaderTracker = new ChainHeaderTracker() as Mocked<ChainHeaderTracker>;

  beforeAll(async () => {
    const secretKeys = Array.from({length: 3}, (_, i) => SecretKey.fromBytes(toBufferBE(BigInt(i + 1), 32)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore = await initValidatorStore(secretKeys, api);

    // Defensive default for the post-Fulu v2 branch — individual tests override as needed.
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );
  });

  let controller: AbortController; // To stop clock
  let onNewHeadCallback: (headEvent: HeadEventData) => Promise<void>;

  beforeEach(() => {
    controller = new AbortController();
    vi.spyOn(chainHeaderTracker, "runOnNewHead");
    chainHeaderTracker.runOnNewHead.mockImplementation((callback) => {
      onNewHeadCallback = callback;
    });
  });
  afterEach(() => controller.abort());

  it("Should fetch and persist block duties on epoch tick, notify on slot tick", async () => {
    const slot = 0;
    const duties: routes.validator.ProposerDutyList = [{slot, validatorIndex: 0, pubkey: pubkeys[0]}];

    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: duties, meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const notifyBlockProductionFn = vi.fn();
    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      preFuluConfig,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      null
    );
    dutiesService.setNotifyBlockProductionFn(notifyBlockProductionFn);

    // Epoch tick populates the cache, slot tick fires the notification
    await clock.tickEpochFns(0, controller.signal);
    await clock.tickSlotFns(slot, controller.signal);

    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({0: {dependentRoot: ZERO_HASH_HEX, data: duties}});
    expect(dutiesService.getblockProposersAtSlot(slot)).toEqual([pubkeys[0]]);
    expect(notifyBlockProductionFn).toHaveBeenCalledOnce();
    expect(notifyBlockProductionFn).toHaveBeenCalledWith(slot, [pubkeys[0]]);
  });

  it("Should notify cached proposers even if slot tick precedes epoch tick (cold-cache startup)", async () => {
    const slot = 0;
    const duties: routes.validator.ProposerDutyList = [{slot, validatorIndex: 0, pubkey: pubkeys[0]}];

    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: duties, meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const notifyBlockProductionFn = vi.fn();
    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      preFuluConfig,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      null
    );
    dutiesService.setNotifyBlockProductionFn(notifyBlockProductionFn);

    // Slot ticks first (cache empty → no notify); then epoch tick fetches and back-fills the
    // notification for the active slot.
    await clock.tickSlotFns(slot, controller.signal);
    expect(notifyBlockProductionFn).not.toHaveBeenCalled();

    await clock.tickEpochFns(0, controller.signal);
    expect(notifyBlockProductionFn).toHaveBeenCalledOnce();
    expect(notifyBlockProductionFn).toHaveBeenCalledWith(slot, [pubkeys[0]]);
  });

  it("Post-Fulu epoch tick fetches current and next epoch proposer duties", async () => {
    const dutiesEpoch0: routes.validator.ProposerDutyList = [{slot: 0, validatorIndex: 0, pubkey: pubkeys[0]}];
    const dutiesEpoch1: routes.validator.ProposerDutyList = [{slot: 32, validatorIndex: 1, pubkey: pubkeys[1]}];
    const depRootEpoch0 = ZERO_HASH_HEX;
    const depRootEpoch1 = toHex(Buffer.alloc(32, 9));

    api.validator.getProposerDutiesV2.mockImplementation(async ({epoch}) =>
      epoch === 0
        ? mockApiResponse({data: dutiesEpoch0, meta: {dependentRoot: depRootEpoch0, executionOptimistic: false}})
        : mockApiResponse({data: dutiesEpoch1, meta: {dependentRoot: depRootEpoch1, executionOptimistic: false}})
    );

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      postFuluConfig,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      null
    );

    await clock.tickEpochFns(0, controller.signal);

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);
    expect(api.validator.getProposerDutiesV2.mock.calls.map((c) => c[0].epoch)).toEqual([0, 1]);
    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({
      0: {dependentRoot: depRootEpoch0, data: dutiesEpoch0},
      1: {dependentRoot: depRootEpoch1, data: dutiesEpoch1},
    });
  });

  it("Pre-Fulu epoch tick fetches only current epoch", async () => {
    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const clock = new ClockMock();
    new BlockDutiesService(preFuluConfig, loggerVc, api, clock, validatorStore, chainHeaderTracker, null);

    await clock.tickEpochFns(0, controller.signal);

    expect(api.validator.getProposerDuties).toHaveBeenCalledTimes(1);
    expect(api.validator.getProposerDuties.mock.calls[0][0]).toEqual({epoch: 0});
  });

  it("Refetches and re-notifies on head-event dep_root mismatch (reorg)", async () => {
    const slot = 1;
    const dependentRootDiff = toHex(Buffer.alloc(32, 1));
    const dutiesBeforeReorg: routes.validator.ProposerDutyList = [{slot, validatorIndex: 0, pubkey: pubkeys[0]}];
    const dutiesAfterReorg: routes.validator.ProposerDutyList = [{slot, validatorIndex: 1, pubkey: pubkeys[1]}];

    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: dutiesBeforeReorg, meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const notifyBlockProductionFn = vi.fn();
    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      preFuluConfig,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      null
    );
    dutiesService.setNotifyBlockProductionFn(notifyBlockProductionFn);

    await clock.tickEpochFns(0, controller.signal);
    await clock.tickSlotFns(slot, controller.signal);

    expect(notifyBlockProductionFn).toHaveBeenCalledOnce();
    expect(notifyBlockProductionFn.mock.calls[0]).toEqual([slot, [pubkeys[0]]]);

    // Simulate SSE: new head with a different dep_root for the current epoch
    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: dutiesAfterReorg, meta: {dependentRoot: dependentRootDiff, executionOptimistic: false}})
    );
    await onNewHeadCallback({
      slot,
      head: dependentRootDiff,
      previousDutyDependentRoot: ZERO_HASH_HEX,
      currentDutyDependentRoot: dependentRootDiff,
    });

    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({
      0: {dependentRoot: dependentRootDiff, data: dutiesAfterReorg},
    });
    expect(notifyBlockProductionFn).toHaveBeenCalledTimes(2);
    expect(notifyBlockProductionFn.mock.calls[1]).toEqual([slot, [pubkeys[1]]]);
  });

  it("Does not refetch when head-event dep_root matches the cache", async () => {
    const slot = 1;
    const duties: routes.validator.ProposerDutyList = [{slot, validatorIndex: 0, pubkey: pubkeys[0]}];

    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: duties, meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const clock = new ClockMock();
    new BlockDutiesService(preFuluConfig, loggerVc, api, clock, validatorStore, chainHeaderTracker, null);

    await clock.tickEpochFns(0, controller.signal);
    expect(api.validator.getProposerDuties).toHaveBeenCalledTimes(1);

    await onNewHeadCallback({
      slot,
      head: ZERO_HASH_HEX,
      previousDutyDependentRoot: ZERO_HASH_HEX,
      currentDutyDependentRoot: ZERO_HASH_HEX,
    });

    // No refetch because dep_root matched
    expect(api.validator.getProposerDuties).toHaveBeenCalledTimes(1);
  });

  it("Post-Fulu head event detects dep_root change for both current and next epoch", async () => {
    const depRootEpoch0 = toHex(Buffer.alloc(32, 10));
    const depRootEpoch1 = toHex(Buffer.alloc(32, 11));
    const depRootEpoch0Reorg = toHex(Buffer.alloc(32, 20));
    const depRootEpoch1Reorg = toHex(Buffer.alloc(32, 21));

    let epoch0DepRoot = depRootEpoch0;
    let epoch1DepRoot = depRootEpoch1;
    api.validator.getProposerDutiesV2.mockImplementation(async ({epoch}) =>
      mockApiResponse({
        data: [],
        meta: {dependentRoot: epoch === 0 ? epoch0DepRoot : epoch1DepRoot, executionOptimistic: false},
      })
    );

    const clock = new ClockMock();
    new BlockDutiesService(postFuluConfig, loggerVc, api, clock, validatorStore, chainHeaderTracker, null);

    await clock.tickEpochFns(0, controller.signal);
    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(2);

    // Reorg invalidates both epochs
    epoch0DepRoot = depRootEpoch0Reorg;
    epoch1DepRoot = depRootEpoch1Reorg;
    await onNewHeadCallback({
      slot: 0,
      head: ZERO_HASH_HEX,
      previousDutyDependentRoot: depRootEpoch0Reorg, // post-Fulu maps to proposer_dep_root(currentEpoch)
      currentDutyDependentRoot: depRootEpoch1Reorg, //  post-Fulu maps to proposer_dep_root(nextEpoch)
    });

    expect(api.validator.getProposerDutiesV2).toHaveBeenCalledTimes(4);
    // Each epoch refetched once
    const refetchEpochs = api.validator.getProposerDutiesV2.mock.calls.slice(2).map((c) => c[0].epoch);
    expect(refetchEpochs.sort()).toEqual([0, 1]);
  });

  it("Pre-Fulu last slot of epoch schedules a boundary fetch for nextEpoch", async () => {
    const epoch0Duties: routes.validator.ProposerDutyList = [];
    const epoch1Duties: routes.validator.ProposerDutyList = [{slot: 32, validatorIndex: 0, pubkey: pubkeys[0]}];

    api.validator.getProposerDuties.mockImplementation(async ({epoch}) =>
      mockApiResponse({
        data: epoch === 0 ? epoch0Duties : epoch1Duties,
        meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false},
      })
    );

    const clock = new ClockMock();
    new BlockDutiesService(preFuluConfig, loggerVc, api, clock, validatorStore, chainHeaderTracker, null);

    await clock.tickEpochFns(0, controller.signal);
    expect(api.validator.getProposerDuties).toHaveBeenCalledTimes(1);
    expect(api.validator.getProposerDuties.mock.calls[0][0]).toEqual({epoch: 0});

    // Last slot of epoch 0 → schedules `pollBeaconProposersBeforeBoundary` (fire-and-forget).
    // ClockMock returns 0 for `msToSlot`, so the sleep resolves immediately.
    await clock.tickSlotFns(31, controller.signal);
    // Yield to let the fire-and-forget poll resolve
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(api.validator.getProposerDuties).toHaveBeenCalledTimes(2);
    expect(api.validator.getProposerDuties.mock.calls[1][0]).toEqual({epoch: 1});
  });

  it("Pre-Fulu mid-epoch slot tick does NOT schedule a boundary fetch", async () => {
    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const clock = new ClockMock();
    new BlockDutiesService(preFuluConfig, loggerVc, api, clock, validatorStore, chainHeaderTracker, null);

    await clock.tickEpochFns(0, controller.signal);
    expect(api.validator.getProposerDuties).toHaveBeenCalledTimes(1);

    // Mid-epoch slot tick: notify only, no boundary fetch
    await clock.tickSlotFns(15, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(api.validator.getProposerDuties).toHaveBeenCalledTimes(1);
  });

  it("Post-Fulu last slot of epoch does NOT schedule a pre-Fulu boundary fetch", async () => {
    api.validator.getProposerDutiesV2.mockResolvedValue(
      mockApiResponse({data: [], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const clock = new ClockMock();
    new BlockDutiesService(postFuluConfig, loggerVc, api, clock, validatorStore, chainHeaderTracker, null);

    await clock.tickEpochFns(0, controller.signal);
    const callsAfterEpochTick = api.validator.getProposerDutiesV2.mock.calls.length;

    await clock.tickSlotFns(31, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // No extra fetch beyond what `runEveryEpoch` already did — boundary poll is pre-Fulu only
    expect(api.validator.getProposerDutiesV2.mock.calls.length).toBe(callsAfterEpochTick);
  });

  it("Should remove signer from duty across epochs", async () => {
    const duties: routes.validator.ProposerDutyList = [
      {slot: 0, validatorIndex: 0, pubkey: pubkeys[0]},
      {slot: 0, validatorIndex: 1, pubkey: pubkeys[1]},
      {slot: 33, validatorIndex: 2, pubkey: pubkeys[2]},
    ];
    const dutiesRemoved: routes.validator.ProposerDutyList = [
      {slot: 0, validatorIndex: 1, pubkey: pubkeys[1]},
      {slot: 33, validatorIndex: 2, pubkey: pubkeys[2]},
    ];

    api.validator.getProposerDuties.mockResolvedValue(
      mockApiResponse({data: duties, meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(
      preFuluConfig,
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeaderTracker,
      null
    );

    await clock.tickEpochFns(0, controller.signal);
    await clock.tickEpochFns(1, controller.signal);

    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({
      0: {dependentRoot: ZERO_HASH_HEX, data: duties},
      1: {dependentRoot: ZERO_HASH_HEX, data: duties},
    });

    dutiesService.removeDutiesForKey(toHexString(pubkeys[0]));

    expect(Object.fromEntries(dutiesService["proposers"])).toEqual({
      0: {dependentRoot: ZERO_HASH_HEX, data: dutiesRemoved},
      1: {dependentRoot: ZERO_HASH_HEX, data: dutiesRemoved},
    });
  });
});
