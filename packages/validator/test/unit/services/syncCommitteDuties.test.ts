import {describe, it, expect, beforeAll, beforeEach, afterEach} from "vitest";
import {when} from "vitest-when";
import {toBufferBE} from "bigint-buffer";
import {SecretKey} from "@chainsafe/blst";
import {toHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {
  SyncCommitteeDutiesService,
  SyncDutyAndProofs,
  SyncDutySubnet,
} from "../../../src/services/syncCommitteeDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {initValidatorStore} from "../../utils/validatorStore.js";
import {syncCommitteeIndicesToSubnets} from "../../../src/services/utils.js";

/* eslint-disable @typescript-eslint/naming-convention */

describe("SyncCommitteeDutiesService", function () {
  const api = getApiClientStub();

  let validatorStore: ValidatorStore;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const altair0Config = createChainForkConfig({
    ...mainnetConfig,
    ALTAIR_FORK_EPOCH: 0, // Activate Altair immediately
  });

  const indices = [4, 100];
  // Sample validator
  const defaultValidator: routes.beacon.ValidatorResponse = {
    index: indices[0],
    balance: 32e9,
    status: "active",
    validator: ssz.phase0.Validator.defaultValue(),
  };

  beforeAll(async () => {
    const secretKeys = [
      SecretKey.deserialize(toBufferBE(BigInt(98), 32)),
      SecretKey.deserialize(toBufferBE(BigInt(99), 32)),
    ];
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().serialize());
    validatorStore = await initValidatorStore(secretKeys, api, altair0Config);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
    // Reply with active validators
    const validatorResponses = [0, 1].map((i) => ({
      ...defaultValidator,
      index: indices[i],
      validator: {...defaultValidator.validator, pubkey: pubkeys[i]},
    }));
    api.beacon.getStateValidators.mockResolvedValue(
      mockApiResponse({data: validatorResponses, meta: {executionOptimistic: false, finalized: false}})
    );
  });
  afterEach(() => controller.abort());

  it("Should fetch indexes and duties", async function () {
    // Reply with some duties
    const slot = 1;
    const duty: routes.validator.SyncDuty = {
      pubkey: pubkeys[0],
      validatorIndex: indices[0],
      validatorSyncCommitteeIndices: [7],
    };
    api.validator.getSyncCommitteeDuties.mockResolvedValue(
      mockApiResponse({data: [duty], meta: {executionOptimistic: false}})
    );

    // Accept all subscriptions
    api.validator.prepareSyncCommitteeSubnets.mockResolvedValue(mockApiResponse({}));

    // Clock will call runAttesterDutiesTasks() immediately
    const clock = new ClockMock();
    const dutiesService = new SyncCommitteeDutiesService(altair0Config, loggerVc, api, clock, validatorStore, null);

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Validator index should be persisted
    // Validator index should be persisted
    expect(validatorStore.getAllLocalIndices()).toEqual(indices);
    for (let i = 0; i < indices.length; i++) {
      expect(validatorStore.getPubkeyOfIndex(indices[i])).toBe(toHexString(pubkeys[i]));
    }

    // Duties for this and next epoch should be persisted
    const dutiesByIndexByPeriodObj = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );

    expect(dutiesByIndexByPeriodObj).toEqual({
      0: {[indices[0]]: {duty: toSyncDutySubnet(duty)}},
      1: {[indices[0]]: {duty: toSyncDutySubnet(duty)}},
    } as typeof dutiesByIndexByPeriodObj);

    expect(await dutiesService.getDutiesAtSlot(slot)).toEqual([
      {duty: toSyncDutySubnet(duty), selectionProofs: [{selectionProof: null, subcommitteeIndex: 0}]},
    ] as SyncDutyAndProofs[]);

    expect(api.validator.prepareSyncCommitteeSubnets).toHaveBeenCalledOnce();
  });

  /**
   * Reproduce https://github.com/ChainSafe/lodestar/issues/3572
   */
  it("should remove redundant duties", async function () {
    // Reply with some duties
    const duty: routes.validator.SyncDuty = {
      pubkey: pubkeys[0],
      validatorIndex: indices[0],
      validatorSyncCommitteeIndices: [7],
    };
    when(api.validator.getSyncCommitteeDuties)
      .calledWith({epoch: 0, indices})
      .thenResolve(mockApiResponse({data: [duty], meta: {executionOptimistic: false}}));
    // sync period 1 should all return empty
    when(api.validator.getSyncCommitteeDuties)
      .calledWith({epoch: 256, indices})
      .thenResolve(mockApiResponse({data: [], meta: {executionOptimistic: false}}));
    when(api.validator.getSyncCommitteeDuties)
      .calledWith({epoch: 257, indices})
      .thenResolve(mockApiResponse({data: [], meta: {executionOptimistic: false}}));
    const duty2: routes.validator.SyncDuty = {
      pubkey: pubkeys[1],
      validatorIndex: indices[1],
      validatorSyncCommitteeIndices: [5],
    };
    when(api.validator.getSyncCommitteeDuties)
      .calledWith({epoch: 1, indices})
      .thenResolve(mockApiResponse({data: [duty2], meta: {executionOptimistic: false}}));

    // Clock will call runAttesterDutiesTasks() immediately
    const clock = new ClockMock();
    const dutiesService = new SyncCommitteeDutiesService(altair0Config, loggerVc, api, clock, validatorStore, null);

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Duties for this and next epoch should be persisted
    let dutiesByIndexByPeriodObj = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );
    expect(dutiesByIndexByPeriodObj).toEqual({
      0: {[indices[0]]: {duty: toSyncDutySubnet(duty)}},
      1: {},
    } as typeof dutiesByIndexByPeriodObj);

    await clock.tickEpochFns(1, controller.signal);

    dutiesByIndexByPeriodObj = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );
    expect(dutiesByIndexByPeriodObj).toEqual({
      0: {[indices[1]]: {duty: toSyncDutySubnet(duty2)}},
      1: {},
    } as typeof dutiesByIndexByPeriodObj);
  });

  it("Should remove signer from sync committee duties", async function () {
    // Reply with some duties
    const duty1: routes.validator.SyncDuty = {
      pubkey: pubkeys[0],
      validatorIndex: indices[0],
      validatorSyncCommitteeIndices: [7],
    };
    const duty2: routes.validator.SyncDuty = {
      pubkey: pubkeys[1],
      validatorIndex: indices[1],
      validatorSyncCommitteeIndices: [7],
    };
    when(api.validator.getSyncCommitteeDuties)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      .calledWith({epoch: expect.any(Number), indices})
      .thenResolve(mockApiResponse({data: [duty1, duty2], meta: {executionOptimistic: false}}));

    // Accept all subscriptions
    api.validator.prepareSyncCommitteeSubnets.mockResolvedValue(mockApiResponse({}));

    // Clock will call runAttesterDutiesTasks() immediately
    const clock = new ClockMock();
    const dutiesService = new SyncCommitteeDutiesService(altair0Config, loggerVc, api, clock, validatorStore, null);

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Duties for this and next epoch should be persisted
    const dutiesByIndexByPeriodObj = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );

    expect(dutiesByIndexByPeriodObj).toEqual({
      0: {
        [indices[0]]: {duty: toSyncDutySubnet(duty1)},
        [indices[1]]: {duty: toSyncDutySubnet(duty2)},
      },
      1: {
        [indices[0]]: {duty: toSyncDutySubnet(duty1)},
        [indices[1]]: {duty: toSyncDutySubnet(duty2)},
      },
    } as typeof dutiesByIndexByPeriodObj);
    // then remove signer with pubkeys[0]
    dutiesService.removeDutiesForKey(toHexString(pubkeys[0]));

    // Removed public key should be removed from duties for this and next epoch should be persisted
    const dutiesByIndexByPeriodObjAfterRemoval = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );
    expect(dutiesByIndexByPeriodObjAfterRemoval).toEqual({
      0: {[indices[1]]: {duty: toSyncDutySubnet(duty2)}},
      1: {[indices[1]]: {duty: toSyncDutySubnet(duty2)}},
    } as typeof dutiesByIndexByPeriodObjAfterRemoval);
  });
});

function toSyncDutySubnet(duty: routes.validator.SyncDuty): SyncDutySubnet {
  return {
    pubkey: toHexString(duty.pubkey),
    validatorIndex: duty.validatorIndex,
    subnets: syncCommitteeIndicesToSubnets(duty.validatorSyncCommitteeIndices),
  };
}
