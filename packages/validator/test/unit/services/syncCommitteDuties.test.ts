import {AbortController} from "@chainsafe/abort-controller";
import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/default";
import {routes} from "@chainsafe/lodestar-api";
import {SyncCommitteeDutiesService} from "../../../src/services/syncCommitteeDuties";
import {ValidatorStore} from "../../../src/services/validatorStore";
import {getApiClientStub} from "../../utils/apiStub";
import {loggerVc, testLogger} from "../../utils/logger";
import {ClockMock} from "../../utils/clock";
import {IndicesService} from "../../../src/services/indices";
import {ssz} from "@chainsafe/lodestar-types";

/* eslint-disable @typescript-eslint/naming-convention */

describe("SyncCommitteeDutiesService", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const ZERO_HASH = Buffer.alloc(32, 0);

  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const config = createIChainForkConfig({
    ...mainnetConfig,
    ALTAIR_FORK_EPOCH: 0, // Activate Altair immediatelly
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
    validatorStore.votingPubkeys.returns(pubkeys.map(toHexString));
    validatorStore.hasVotingPubkey.returns(true);
    validatorStore.signAttestationSelectionProof.resolves(ZERO_HASH);
    validatorStore.signSyncCommitteeSelectionProof.resolves(ZERO_HASH);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => {
    controller = new AbortController();
    // Reply with active validators
    const validatorReponses = [0, 1].map((i) => ({
      ...defaultValidator,
      index: indices[i],
      validator: {...defaultValidator.validator, pubkey: pubkeys[i]},
    }));
    api.beacon.getStateValidators.resolves({data: validatorReponses});
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
    api.validator.getSyncCommitteeDuties.resolves({dependentRoot: ZERO_HASH, data: [duty]});

    // Accept all subscriptions
    api.validator.prepareSyncCommitteeSubnets.resolves();

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new ClockMock();
    const indicesService = new IndicesService(logger, api, validatorStore);
    const dutiesService = new SyncCommitteeDutiesService(config, loggerVc, api, clock, validatorStore, indicesService);

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Validator index should be persisted
    expect(Object.fromEntries(indicesService["pubkey2index"])).to.deep.equal(
      {
        [toHexString(pubkeys[0])]: indices[0],
        [toHexString(pubkeys[1])]: indices[1],
      },
      "Wrong dutiesService.indices Map"
    );

    // Duties for this and next epoch should be persisted
    const dutiesByIndexByPeriodObj = Object.fromEntries(
      Array.from(dutiesService["dutiesByIndexByPeriod"].entries()).map(([period, dutiesByIndex]) => [
        period,
        Object.fromEntries(dutiesByIndex),
      ])
    );
    expect(dutiesByIndexByPeriodObj).to.deep.equal(
      {
        0: {[indices[0]]: {dependentRoot: ZERO_HASH, duty}},
        1: {[indices[0]]: {dependentRoot: ZERO_HASH, duty}},
      },
      "Wrong dutiesService.dutiesByIndexByPeriod Map"
    );

    expect(await dutiesService.getDutiesAtSlot(slot)).to.deep.equal(
      [{duty, selectionProofs: [{selectionProof: null, subcommitteeIndex: 0}]}],
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
      .resolves({dependentRoot: ZERO_HASH, data: [duty]});
    // sync period 1 should all return empty
    api.validator.getSyncCommitteeDuties.withArgs(256, sinon.match.any).resolves({dependentRoot: ZERO_HASH, data: []});
    api.validator.getSyncCommitteeDuties.withArgs(257, sinon.match.any).resolves({dependentRoot: ZERO_HASH, data: []});
    const duty2: routes.validator.SyncDuty = {
      pubkey: pubkeys[1],
      validatorIndex: indices[1],
      validatorSyncCommitteeIndices: [5],
    };
    api.validator.getSyncCommitteeDuties
      .withArgs(1, sinon.match.any)
      .resolves({dependentRoot: ZERO_HASH, data: [duty2]});

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new ClockMock();
    const indicesService = new IndicesService(logger, api, validatorStore);
    const dutiesService = new SyncCommitteeDutiesService(config, loggerVc, api, clock, validatorStore, indicesService);

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
        0: {[indices[0]]: {dependentRoot: ZERO_HASH, duty}},
        1: {},
      },
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
        0: {[indices[1]]: {dependentRoot: ZERO_HASH, duty: duty2}},
        1: {},
      },
      "Wrong dutiesService.dutiesByIndexByPeriod Map"
    );
  });
});
