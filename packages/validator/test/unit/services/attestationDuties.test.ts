import {toBufferBE} from "bigint-buffer";
import {Mocked, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {chainConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {AttestationDutiesService} from "../../../src/services/attestationDuties.js";
import {ChainHeaderTracker, HeadEventData} from "../../../src/services/chainHeaderTracker.js";
import {SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {ClockMock} from "../../utils/clock.js";
import {loggerVc} from "../../utils/logger.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

vi.mock("../../../src/services/chainHeaderTracker.js");

describe("AttestationDutiesService", () => {
  const api = getApiClientStub();

  let validatorStore: ValidatorStore;

  // @ts-expect-error - Mocked class don't need parameters
  const chainHeadTracker = new ChainHeaderTracker() as Mocked<ChainHeaderTracker>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  // Sample validator
  const index = 4;
  // Sample validator
  const defaultValidator: routes.beacon.ValidatorResponse = {
    index,
    balance: 32e9,
    status: "active_ongoing",
    validator: ssz.phase0.Validator.defaultValue(),
  };

  beforeAll(async () => {
    const secretKeys = [SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore = await initValidatorStore(secretKeys, api, chainConfig);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
    // Reply with an active validator that has an index
    const validatorResponse = {
      ...defaultValidator,
      index,
      validator: {...defaultValidator.validator, pubkey: pubkeys[0]},
    };
    api.beacon.postStateValidators.mockResolvedValue(
      mockApiResponse({data: [validatorResponse], meta: {executionOptimistic: false, finalized: false}})
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    controller.abort();
  });

  it("Should fetch indexes and duties", async () => {
    // Reply with some duties
    const slot = 1;
    const epoch = computeEpochAtSlot(slot);
    const duty: routes.validator.AttesterDuty = {
      slot: slot,
      committeeIndex: 1,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: index,
      pubkey: pubkeys[0],
    };
    api.validator.getAttesterDuties.mockResolvedValue(
      mockApiResponse({data: [duty], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue(mockApiResponse({}));

    // Clock will call runDutiesTasks() immediately
    const clock = new ClockMock();
    const syncingStatusTracker = new SyncingStatusTracker(loggerVc, api, clock, null);
    const dutiesService = new AttestationDutiesService(
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker,
      null
    );

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Validator index should be persisted
    expect(validatorStore.getAllLocalIndices()).toEqual([index]);
    expect(validatorStore.getPubkeyOfIndex(index)).toBe(toHexString(pubkeys[0]));

    // Duties for this and next epoch should be persisted
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(epoch)?.dutiesByIndex || new Map())).toEqual({
      // Since the ZERO_HASH won't pass the isAggregator test, selectionProof is null
      [index]: {duty, selectionProof: null},
    });
    expect(
      Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(epoch + 1)?.dutiesByIndex || new Map())
    ).toEqual({
      // Since the ZERO_HASH won't pass the isAggregator test, selectionProof is null
      [index]: {duty, selectionProof: null},
    });

    expect(dutiesService.getDutiesAtSlot(slot)).toEqual([{duty, selectionProof: null}]);

    expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledOnce();
  });

  it("Should remove signer from attestation duties", async () => {
    // Reply with some duties
    const slot = 1;
    const duty: routes.validator.AttesterDuty = {
      slot: slot,
      committeeIndex: 1,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: index,
      pubkey: pubkeys[0],
    };
    api.validator.getAttesterDuties.mockResolvedValue(
      mockApiResponse({data: [duty], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue(mockApiResponse({}));

    // Clock will call runDutiesTasks() immediately
    const clock = new ClockMock();
    const syncingStatusTracker = new SyncingStatusTracker(loggerVc, api, clock, null);
    const dutiesService = new AttestationDutiesService(
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker,
      null
    );

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // first confirm duties for this and next epoch should be persisted
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(0)?.dutiesByIndex || new Map())).toEqual({
      4: {duty: duty, selectionProof: null},
    });
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(1)?.dutiesByIndex || new Map())).toEqual({
      4: {duty: duty, selectionProof: null},
    });
    // then remove
    dutiesService.removeDutiesForKey(toHexString(pubkeys[0]));
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"])).toEqual({});
  });

  it("Should fetch duties when node is resynced", async () => {
    // Node is syncing
    api.node.getSyncingStatus.mockResolvedValue(
      mockApiResponse({data: {headSlot: 0, syncDistance: 1, isSyncing: true, isOptimistic: false, elOffline: false}})
    );
    api.validator.getAttesterDuties.mockRejectedValue(Error("Node is syncing"));
    api.validator.prepareBeaconCommitteeSubnet.mockRejectedValue(Error("Node is syncing"));

    // Clock will call runDutiesTasks() immediately
    const clock = new ClockMock();
    const syncingStatusTracker = new SyncingStatusTracker(loggerVc, api, clock, null);
    const dutiesService = new AttestationDutiesService(
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker,
      null
    );

    // Trigger clock for slot and epoch
    await clock.tickEpochFns(0, controller.signal);
    await clock.tickSlotFns(1, controller.signal);

    const dutySlot = 3;
    const epoch = computeEpochAtSlot(dutySlot);

    // Duties for slot should be empty as node is still syncing
    expect(dutiesService.getDutiesAtSlot(dutySlot)).toEqual([]);

    // Node is synced now
    api.node.getSyncingStatus.mockResolvedValue(
      mockApiResponse({data: {headSlot: 1, syncDistance: 0, isSyncing: false, isOptimistic: false, elOffline: false}})
    );

    // Reply with some duties on next call
    const duty: routes.validator.AttesterDuty = {
      slot: dutySlot,
      committeeIndex: 1,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: index,
      pubkey: pubkeys[0],
    };
    api.validator.getAttesterDuties.mockResolvedValue(
      mockApiResponse({data: [duty], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue(mockApiResponse({}));

    // Only tick clock for slot to not trigger regular polling
    await clock.tickSlotFns(2, controller.signal);

    // Validator index should be persisted
    expect(validatorStore.getAllLocalIndices()).toEqual([index]);
    expect(validatorStore.getPubkeyOfIndex(index)).toBe(toHexString(pubkeys[0]));

    // Duties for this and next epoch should be persisted
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(epoch)?.dutiesByIndex || new Map())).toEqual({
      // Since the ZERO_HASH won't pass the isAggregator test, selectionProof is null
      [index]: {duty, selectionProof: null},
    });
    expect(
      Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(epoch + 1)?.dutiesByIndex || new Map())
    ).toEqual({
      // Since the ZERO_HASH won't pass the isAggregator test, selectionProof is null
      [index]: {duty, selectionProof: null},
    });

    expect(dutiesService.getDutiesAtSlot(dutySlot)).toEqual([{duty, selectionProof: null}]);

    expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledOnce();
  });

  it("Should fetch duties with distributed aggregation selection", async () => {
    // Reply with some duties
    const slot = 1;
    const epoch = computeEpochAtSlot(slot);
    const duty: routes.validator.AttesterDuty = {
      slot: slot,
      committeeIndex: 1,
      committeeLength: 120,
      committeesAtSlot: 120,
      validatorCommitteeIndex: 1,
      validatorIndex: index,
      pubkey: pubkeys[0],
    };
    api.validator.getAttesterDuties.mockResolvedValue(
      mockApiResponse({data: [duty], meta: {dependentRoot: ZERO_HASH_HEX, executionOptimistic: false}})
    );

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue(mockApiResponse({}));

    // Mock distributed validator middleware client selections endpoint
    // and return a selection proof that passes `is_aggregator` test
    const aggregatorSelectionProof = Buffer.alloc(1, 0x10);
    api.validator.submitBeaconCommitteeSelections.mockResolvedValue(
      mockApiResponse({data: [{validatorIndex: index, slot, selectionProof: aggregatorSelectionProof}]})
    );

    // Clock will call runDutiesTasks() immediately
    const clock = new ClockMock();
    const syncingStatusTracker = new SyncingStatusTracker(loggerVc, api, clock, null);
    const dutiesService = new AttestationDutiesService(
      loggerVc,
      api,
      clock,
      validatorStore,
      chainHeadTracker,
      syncingStatusTracker,
      null,
      {distributedAggregationSelection: true}
    );

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Validator index should be persisted
    expect(validatorStore.getAllLocalIndices()).toEqual([index]);
    expect(validatorStore.getPubkeyOfIndex(index)).toBe(toHexString(pubkeys[0]));

    // Must submit partial beacon committee selection proofs for current and next epoch
    expect(api.validator.submitBeaconCommitteeSelections).toHaveBeenCalledTimes(2);
    expect(api.validator.submitBeaconCommitteeSelections).toHaveBeenCalledWith({
      selections: [
        expect.objectContaining({
          validatorIndex: index,
          slot,
        }),
      ],
    });

    // Duties for current epoch should be persisted with selection proof set for aggregator
    const dutiesAtEpoch = dutiesService["dutiesByIndexByEpoch"].get(epoch);
    expect(dutiesAtEpoch).toBeDefined();
    const dutyAndProof = dutiesAtEpoch?.dutiesByIndex.get(index);
    expect(dutyAndProof).toBeDefined();
    expect(dutyAndProof?.duty).toEqual(duty);
    // Selection proof should be set since the mocked proof passes `is_aggregator`
    expect(dutyAndProof?.selectionProof).toEqual(aggregatorSelectionProof);

    // Must subscribe validator as aggregator on beacon committee subnet
    expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledOnce();
    expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledWith({
      subscriptions: expect.arrayContaining([
        expect.objectContaining({
          validatorIndex: index,
          slot,
          isAggregator: true,
        }),
      ]),
    });
  });

  describe("Reorg handling", () => {
    const oldDependentRoot = toRootHex(Buffer.alloc(32, 1));
    const newDependentRoot = toRootHex(Buffer.alloc(32, 2));
    const headBlockRoot = toRootHex(Buffer.alloc(32, 3));

    let clock: ClockMock;
    let dutiesService: AttestationDutiesService;
    let onNewHeadCallback: (headEvent: HeadEventData) => Promise<void>;

    beforeEach(() => {
      api.validator.prepareBeaconCommitteeSubnet.mockResolvedValue(mockApiResponse({}));

      clock = new ClockMock();
      const syncingStatusTracker = new SyncingStatusTracker(loggerVc, api, clock, null);

      vi.spyOn(chainHeadTracker, "runOnNewHead");
      chainHeadTracker.runOnNewHead.mockImplementation((callback) => {
        onNewHeadCallback = callback;
      });

      dutiesService = new AttestationDutiesService(
        loggerVc,
        api,
        clock,
        validatorStore,
        chainHeadTracker,
        syncingStatusTracker,
        null
      );
    });

    it("Should resubscribe to beacon subnets when current epoch dependent root changes", async () => {
      const slot = 5;
      const currentEpoch = computeEpochAtSlot(slot);

      const duty: routes.validator.AttesterDuty = {
        slot,
        committeeIndex: 1,
        committeeLength: 120,
        committeesAtSlot: 120,
        validatorCommitteeIndex: 1,
        validatorIndex: index,
        pubkey: pubkeys[0],
      };

      api.validator.getAttesterDuties.mockResolvedValue(
        mockApiResponse({
          data: [duty],
          meta: {dependentRoot: oldDependentRoot, executionOptimistic: false},
        })
      );

      await clock.tickEpochFns(currentEpoch, controller.signal);

      expect(dutiesService["dutiesByIndexByEpoch"].get(currentEpoch)?.dutiesByIndex.get(index)?.duty).toEqual(duty);
      expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledTimes(1);

      const reorgedDuty: routes.validator.AttesterDuty = {...duty, slot: slot + 1, committeeIndex: 3};
      api.validator.getAttesterDuties.mockResolvedValue(
        mockApiResponse({
          data: [reorgedDuty],
          meta: {dependentRoot: newDependentRoot, executionOptimistic: false},
        })
      );

      await onNewHeadCallback({
        slot,
        head: headBlockRoot,
        previousDutyDependentRoot: newDependentRoot,
        currentDutyDependentRoot: oldDependentRoot,
      });

      expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledTimes(2);
      expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenLastCalledWith({
        subscriptions: [
          {
            validatorIndex: reorgedDuty.validatorIndex,
            committeesAtSlot: reorgedDuty.committeesAtSlot,
            committeeIndex: reorgedDuty.committeeIndex,
            slot: reorgedDuty.slot,
            isAggregator: false,
          },
        ],
      });
      expect(dutiesService["dutiesByIndexByEpoch"].get(currentEpoch)?.dutiesByIndex.get(index)?.duty).toEqual(
        reorgedDuty
      );
    });

    it("Should resubscribe to beacon subnets when next epoch dependent root changes", async () => {
      const slot = 5;
      const currentEpoch = computeEpochAtSlot(slot);
      const nextEpoch = currentEpoch + 1;

      const currentEpochDuty: routes.validator.AttesterDuty = {
        slot,
        committeeIndex: 1,
        committeeLength: 120,
        committeesAtSlot: 120,
        validatorCommitteeIndex: 1,
        validatorIndex: index,
        pubkey: pubkeys[0],
      };

      const nextEpochDuty: routes.validator.AttesterDuty = {
        slot: slot + SLOTS_PER_EPOCH,
        committeeIndex: 2,
        committeeLength: 120,
        committeesAtSlot: 120,
        validatorCommitteeIndex: 1,
        validatorIndex: index,
        pubkey: pubkeys[0],
      };

      // First call for current epoch
      api.validator.getAttesterDuties.mockResolvedValueOnce(
        mockApiResponse({
          data: [currentEpochDuty],
          meta: {dependentRoot: oldDependentRoot, executionOptimistic: false},
        })
      );

      // Second call for next epoch
      api.validator.getAttesterDuties.mockResolvedValueOnce(
        mockApiResponse({
          data: [nextEpochDuty],
          meta: {dependentRoot: oldDependentRoot, executionOptimistic: false},
        })
      );

      await clock.tickEpochFns(currentEpoch, controller.signal);

      expect(dutiesService["dutiesByIndexByEpoch"].get(currentEpoch)?.dutiesByIndex.get(index)?.duty).toEqual(
        currentEpochDuty
      );
      expect(dutiesService["dutiesByIndexByEpoch"].get(nextEpoch)?.dutiesByIndex.get(index)?.duty).toEqual(
        nextEpochDuty
      );
      expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledTimes(1);

      const reorgedNextEpochDuty: routes.validator.AttesterDuty = {...nextEpochDuty, committeeIndex: 4};
      api.validator.getAttesterDuties.mockResolvedValue(
        mockApiResponse({
          data: [reorgedNextEpochDuty],
          meta: {dependentRoot: newDependentRoot, executionOptimistic: false},
        })
      );

      await onNewHeadCallback({
        slot,
        head: headBlockRoot,
        previousDutyDependentRoot: oldDependentRoot,
        currentDutyDependentRoot: newDependentRoot,
      });

      expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledTimes(2);
      expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenLastCalledWith({
        subscriptions: [
          {
            validatorIndex: reorgedNextEpochDuty.validatorIndex,
            committeesAtSlot: reorgedNextEpochDuty.committeesAtSlot,
            committeeIndex: reorgedNextEpochDuty.committeeIndex,
            slot: reorgedNextEpochDuty.slot,
            isAggregator: false,
          },
        ],
      });
      expect(dutiesService["dutiesByIndexByEpoch"].get(nextEpoch)?.dutiesByIndex.get(index)?.duty).toEqual(
        reorgedNextEpochDuty
      );
    });

    it("Should not resubscribe to beacon subnets when dependent root is unchanged", async () => {
      const slot = 5;
      const currentEpoch = computeEpochAtSlot(slot);

      const duty: routes.validator.AttesterDuty = {
        slot,
        committeeIndex: 1,
        committeeLength: 120,
        committeesAtSlot: 120,
        validatorCommitteeIndex: 1,
        validatorIndex: index,
        pubkey: pubkeys[0],
      };

      api.validator.getAttesterDuties.mockResolvedValue(
        mockApiResponse({
          data: [duty],
          meta: {dependentRoot: oldDependentRoot, executionOptimistic: false},
        })
      );

      await clock.tickEpochFns(currentEpoch, controller.signal);

      expect(dutiesService["dutiesByIndexByEpoch"].get(currentEpoch)?.dutiesByIndex.get(index)?.duty).toEqual(duty);
      const initialCalls = api.validator.prepareBeaconCommitteeSubnet.mock.calls.length;

      await onNewHeadCallback({
        slot,
        head: headBlockRoot,
        previousDutyDependentRoot: oldDependentRoot,
        currentDutyDependentRoot: oldDependentRoot,
      });

      expect(api.validator.prepareBeaconCommitteeSubnet).toHaveBeenCalledTimes(initialCalls);
    });
  });
});
