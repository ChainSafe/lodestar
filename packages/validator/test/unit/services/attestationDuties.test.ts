import {describe, it, expect, beforeAll, vi, Mocked, beforeEach, afterEach} from "vitest";
import {toBufferBE} from "bigint-buffer";
import {toHexString} from "@chainsafe/ssz";
import {SecretKey} from "@chainsafe/blst";
import {chainConfig} from "@lodestar/config/default";
import {routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {AttestationDutiesService} from "../../../src/services/attestationDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {initValidatorStore} from "../../utils/validatorStore.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {SyncingStatusTracker} from "../../../src/services/syncingStatusTracker.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";

vi.mock("../../../src/services/chainHeaderTracker.js");

describe("AttestationDutiesService", function () {
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

  it("Should fetch indexes and duties", async function () {
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

  it("Should remove signer from attestation duties", async function () {
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

  it("Should fetch duties when node is resynced", async function () {
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
});
