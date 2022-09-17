import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import {chainConfig} from "@lodestar/config/default";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {AttestationDutiesService} from "../../../src/services/attestationDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {initValidatorStore} from "../../utils/validatorStore.js";
import {ChainHeaderTracker} from "../../../src/services/chainHeaderTracker.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";

describe("AttestationDutiesService", function () {
  const sandbox = sinon.createSandbox();
  const api = getApiClientStub(sandbox);

  let validatorStore: ValidatorStore;

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
    validatorStore = initValidatorStore(secretKeys, api, chainConfig);
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
    api.beacon.getStateValidators.resolves({data: [validatorResponse], executionOptimistic: false});

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
    api.validator.getAttesterDuties.resolves({dependentRoot: ZERO_HASH_HEX, data: [duty], executionOptimistic: false});

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.resolves();

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new ClockMock();
    const dutiesService = new AttestationDutiesService(loggerVc, api, clock, validatorStore, chainHeadTracker, null);

    // Trigger clock onSlot for slot 0
    await clock.tickEpochFns(0, controller.signal);

    // Validator index should be persisted
    expect(validatorStore.getAllLocalIndices()).to.deep.equal([index], "Wrong local indices");
    expect(validatorStore.getPubkeyOfIndex(index)).equals(toHexString(pubkeys[0]), "Wrong pubkey");

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
    api.beacon.getStateValidators.resolves({data: [validatorResponse], executionOptimistic: false});

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
    api.validator.getAttesterDuties.resolves({data: [duty], dependentRoot: ZERO_HASH_HEX, executionOptimistic: false});

    // Accept all subscriptions
    api.validator.prepareBeaconCommitteeSubnet.resolves();

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new ClockMock();
    const dutiesService = new AttestationDutiesService(loggerVc, api, clock, validatorStore, chainHeadTracker, null);

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
