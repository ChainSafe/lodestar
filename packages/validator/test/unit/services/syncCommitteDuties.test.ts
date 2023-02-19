import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {HttpStatusCode, routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {
  SyncCommitteeDutiesService,
  SyncDutyAndProofs,
  SyncDutySubnet,
} from "../../../src/services/syncCommitteeDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {initValidatorStore} from "../../utils/validatorStore.js";
import {syncCommitteeIndicesToSubnets} from "../../../src/services/utils.js";

/* eslint-disable @typescript-eslint/naming-convention */

describe("SyncCommitteeDutiesService", function () {
  const sandbox = sinon.createSandbox();

  const api = getApiClientStub(sandbox);

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

  before(() => {
    const secretKeys = [
      bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32)),
      bls.SecretKey.fromBytes(toBufferBE(BigInt(99), 32)),
    ];
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore = initValidatorStore(secretKeys, api, altair0Config);
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
    api.beacon.getStateValidators.resolves({
      response: {data: validatorResponses, executionOptimistic: false},
      ok: true,
      status: HttpStatusCode.OK,
    });
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
    api.validator.getSyncCommitteeDuties.resolves({
      response: {data: [duty], executionOptimistic: false},
      ok: true,
      status: HttpStatusCode.OK,
    });

    // Accept all subscriptions
    api.validator.prepareSyncCommitteeSubnets.resolves();

    // Clock will call runAttesterDutiesTasks() immediately
    const clock = new ClockMock();
    const dutiesService = new SyncCommitteeDutiesService(altair0Config, loggerVc, api, clock, validatorStore, null);

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Validator index should be persisted
    // Validator index should be persisted
    expect(validatorStore.getAllLocalIndices()).to.deep.equal(indices, "Wrong local indices");
    for (let i = 0; i < indices.length; i++) {
      expect(validatorStore.getPubkeyOfIndex(indices[i])).equals(toHexString(pubkeys[i]), `Wrong pubkey[${i}]`);
    }

    // Duties for this and next epoch should be persisted
    const dutiesByIndexByPeriodObj = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );

    expect(dutiesByIndexByPeriodObj).to.deep.equal(
      {
        0: {[indices[0]]: {duty: toSyncDutySubnet(duty)}},
        1: {[indices[0]]: {duty: toSyncDutySubnet(duty)}},
      } as typeof dutiesByIndexByPeriodObj,
      "Wrong dutiesService.dutiesByIndexByPeriod Map"
    );

    expect(await dutiesService.getDutiesAtSlot(slot)).to.deep.equal(
      [
        {duty: toSyncDutySubnet(duty), selectionProofs: [{selectionProof: null, subcommitteeIndex: 0}]},
      ] as SyncDutyAndProofs[],
      "Wrong getAttestersAtSlot()"
    );

    expect(api.validator.prepareSyncCommitteeSubnets.callCount).to.equal(
      1,
      "prepareSyncCommitteeSubnets() must be called once after getting the duties"
    );
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
    api.validator.getSyncCommitteeDuties
      .withArgs(0, sinon.match.any)
      .resolves({response: {data: [duty], executionOptimistic: false}, ok: true, status: HttpStatusCode.OK});
    // sync period 1 should all return empty
    api.validator.getSyncCommitteeDuties
      .withArgs(256, sinon.match.any)
      .resolves({response: {data: [], executionOptimistic: false}, ok: true, status: HttpStatusCode.OK});
    api.validator.getSyncCommitteeDuties
      .withArgs(257, sinon.match.any)
      .resolves({response: {data: [], executionOptimistic: false}, ok: true, status: HttpStatusCode.OK});
    const duty2: routes.validator.SyncDuty = {
      pubkey: pubkeys[1],
      validatorIndex: indices[1],
      validatorSyncCommitteeIndices: [5],
    };
    api.validator.getSyncCommitteeDuties
      .withArgs(1, sinon.match.any)
      .resolves({response: {data: [duty2], executionOptimistic: false}, ok: true, status: HttpStatusCode.OK});

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
    expect(dutiesByIndexByPeriodObj).to.deep.equal(
      {
        0: {[indices[0]]: {duty: toSyncDutySubnet(duty)}},
        1: {},
      } as typeof dutiesByIndexByPeriodObj,
      "Wrong dutiesService.dutiesByIndexByPeriod Map"
    );

    await clock.tickEpochFns(1, controller.signal);

    dutiesByIndexByPeriodObj = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );
    expect(dutiesByIndexByPeriodObj).to.deep.equal(
      {
        0: {[indices[1]]: {duty: toSyncDutySubnet(duty2)}},
        1: {},
      } as typeof dutiesByIndexByPeriodObj,
      "Wrong dutiesService.dutiesByIndexByPeriod Map"
    );
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
    api.validator.getSyncCommitteeDuties
      .withArgs(sinon.match.any, sinon.match.any)
      .resolves({response: {data: [duty1, duty2], executionOptimistic: false}, ok: true, status: HttpStatusCode.OK});

    // Accept all subscriptions
    api.validator.prepareSyncCommitteeSubnets.resolves();

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

    expect(dutiesByIndexByPeriodObj).to.deep.equal(
      {
        0: {
          [indices[0]]: {duty: toSyncDutySubnet(duty1)},
          [indices[1]]: {duty: toSyncDutySubnet(duty2)},
        },
        1: {
          [indices[0]]: {duty: toSyncDutySubnet(duty1)},
          [indices[1]]: {duty: toSyncDutySubnet(duty2)},
        },
      } as typeof dutiesByIndexByPeriodObj,
      "Wrong dutiesService.dutiesByIndexByPeriod Map"
    );
    // then remove signer with pubkeys[0]
    dutiesService.removeDutiesForKey(toHexString(pubkeys[0]));

    // Removed public key should be removed from duties for this and next epoch should be persisted
    const dutiesByIndexByPeriodObjAfterRemoval = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );
    expect(dutiesByIndexByPeriodObjAfterRemoval).to.deep.equal(
      {
        0: {[indices[1]]: {duty: toSyncDutySubnet(duty2)}},
        1: {[indices[1]]: {duty: toSyncDutySubnet(duty2)}},
      } as typeof dutiesByIndexByPeriodObjAfterRemoval,
      "Wrong dutiesService.dutiesByIndexByPeriod Map"
    );
  });
});

function toSyncDutySubnet(duty: routes.validator.SyncDuty): SyncDutySubnet {
  return {
    pubkey: toHexString(duty.pubkey),
    validatorIndex: duty.validatorIndex,
    subnets: syncCommitteeIndicesToSubnets(duty.validatorSyncCommitteeIndices),
  };
}
