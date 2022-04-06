import {AbortController} from "@chainsafe/abort-controller";
import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@chainsafe/lodestar-api";
import {AttestationDutiesService} from "../../../src/services/attestationDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc, testLogger} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {IndicesService} from "../../../src/services/indices.js";
import {ssz} from "@chainsafe/lodestar-types";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

describe("AttestationDutiesService", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const ZERO_HASH = Buffer.alloc(32, 0);

  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  const chainHeadTracker = sinon.createStubInstance(ChainHeaderTracker) as ChainHeaderTracker &
    sinon.SinonStubbedInstance<ChainHeaderTracker>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  // Sample validator
  const index = 4;
  // Sample validator
  const defaultValidator: routes.beacon.ValidatorResponse = {
    index,
    balance: 32e9,
    status: "active",
    validator: ssz.phase0.Validator.defaultValue(),
  };

  before(() => {
    const secretKeys = [bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32))];
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.returns(pubkeys.map(toHexString));
    validatorStore.hasVotingPubkey.returns(true);
    validatorStore.signAttestationSelectionProof.resolves(ZERO_HASH);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should fetch indexes and duties", async function () {
    // Reply with an active validator that has an index
    const validatorResponse = {
      ...defaultValidator,
      index,
      validator: {...defaultValidator.validator, pubkey: pubkeys[0]},
    };
    api.beacon.getStateValidators.resolves({data: [validatorResponse]});

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
    api.validator.getAttesterDuties.resolves({dependentRoot: ZERO_HASH, data: [duty]});

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.resolves();

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new ClockMock();
    const indicesService = new IndicesService(logger, api, validatorStore);
    const dutiesService = new AttestationDutiesService(
      loggerVc,
      api,
      clock,
      validatorStore,
      indicesService,
      chainHeadTracker
    );

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Validator index should be persisted
    expect(Object.fromEntries(indicesService["pubkey2index"])).to.deep.equal(
      {[toHexString(pubkeys[0])]: index},
      "Wrong dutiesService.indices Map"
    );

    // Duties for this and next epoch should be persisted
    expect(
      Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(epoch)?.dutiesByIndex || new Map())
    ).to.deep.equal(
      {
        // Since the ZERO_HASH won't pass the isAggregator test, selectionProof is null
        [index]: {duty, selectionProof: null},
      },
      "Wrong dutiesService.attesters Map at current epoch"
    );
    expect(
      Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(epoch + 1)?.dutiesByIndex || new Map())
    ).to.deep.equal(
      {
        // Since the ZERO_HASH won't pass the isAggregator test, selectionProof is null
        [index]: {duty, selectionProof: null},
      },
      "Wrong dutiesService.attesters Map at next epoch"
    );

    expect(dutiesService.getDutiesAtSlot(slot)).to.deep.equal(
      [{duty, selectionProof: null}],
      "Wrong getAttestersAtSlot()"
    );

    expect(api.validator.prepareBeaconCommitteeSubnet.callCount).to.equal(
      1,
      "prepareBeaconCommitteeSubnet() must be called once after getting the duties"
    );
  });

  it("Should remove signer from attestation duties", async function () {
    // Reply with an active validator that has an index
    const validatorResponse = {
      ...defaultValidator,
      index,
      validator: {...defaultValidator.validator, pubkey: pubkeys[0]},
    };
    api.beacon.getStateValidators.resolves({data: [validatorResponse]});

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
    api.validator.getAttesterDuties.resolves({dependentRoot: ZERO_HASH, data: [duty]});

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.resolves();

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new ClockMock();
    const indicesService = new IndicesService(logger, api, validatorStore);
    const dutiesService = new AttestationDutiesService(
      loggerVc,
      api,
      clock,
      validatorStore,
      indicesService,
      chainHeadTracker
    );

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // first confirm duties for this and next epoch should be persisted
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(0)?.dutiesByIndex || new Map())).to.deep.equal(
      {
        4: {duty: duty, selectionProof: null},
      },
      "Wrong dutiesService.attesters Map at current epoch"
    );
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"].get(1)?.dutiesByIndex || new Map())).to.deep.equal(
      {
        4: {duty: duty, selectionProof: null},
      },
      "Wrong dutiesService.attesters Map at current epoch"
    );
    // then remove
    dutiesService.removeDutiesForKey(toHexString(pubkeys[0]));
    expect(Object.fromEntries(dutiesService["dutiesByIndexByEpoch"])).to.deep.equal(
      {},
      "Wrong dutiesService.attesters Map at current epoch after removal"
    );
  });
});
