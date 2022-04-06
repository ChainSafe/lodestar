import {AbortController} from "@chainsafe/abort-controller";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {Root} from "@chainsafe/lodestar-types";
import {routes} from "@chainsafe/lodestar-api";
import {BlockDutiesService} from "../../../src/services/blockDuties.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";

type ProposerDutiesRes = {dependentRoot: Root; data: routes.validator.ProposerDuty[]};

describe("BlockDutiesService", function () {
  const sandbox = sinon.createSandbox();
  const ZERO_HASH = Buffer.alloc(32, 0);

  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  before(() => {
    const secretKeys = Array.from({length: 3}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.returns(pubkeys.map(toHexString));
    validatorStore.hasVotingPubkey.returns(true);
    validatorStore.hasSomeValidators.returns(true);
  });

  let controller: AbortController; // To stop clock
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  it("Should fetch and persist block duties", async function () {
    // Reply with some duties
    const slot = 0; // genesisTime is right now, so test with slot = currentSlot
    const duties: ProposerDutiesRes = {
      dependentRoot: ZERO_HASH,
      data: [{slot: slot, validatorIndex: 0, pubkey: pubkeys[0]}],
    };
    api.validator.getProposerDuties.resolves(duties);

    const notifyBlockProductionFn = sinon.stub(); // Returns void

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(loggerVc, api, clock, validatorStore, notifyBlockProductionFn);

    // Trigger clock onSlot for slot 0
    await clock.tickSlotFns(0, controller.signal);

    // Duties for this epoch should be persisted
    expect(Object.fromEntries(dutiesService["proposers"])).to.deep.equal(
      {0: duties},
      "Wrong dutiesService.proposers Map"
    );

    expect(dutiesService.getblockProposersAtSlot(slot)).to.deep.equal([pubkeys[0]], "Wrong getblockProposersAtSlot()");

    expect(notifyBlockProductionFn.callCount).to.equal(
      1,
      "notifyBlockProductionFn() must be called once after getting the duties"
    );
  });

  it("Should call notifyBlockProductionFn again on duties re-org", async () => {
    // A re-org will happen at slot 1
    const DIFF_HASH = Buffer.alloc(32, 1);
    const dutiesBeforeReorg: ProposerDutiesRes = {
      dependentRoot: ZERO_HASH,
      data: [{slot: 1, validatorIndex: 0, pubkey: pubkeys[0]}],
    };
    const dutiesAfterReorg: ProposerDutiesRes = {
      dependentRoot: DIFF_HASH,
      data: [{slot: 1, validatorIndex: 1, pubkey: pubkeys[1]}],
    };

    const notifyBlockProductionFn = sinon.stub(); // Returns void

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(loggerVc, api, clock, validatorStore, notifyBlockProductionFn);

    // Trigger clock onSlot for slot 0
    api.validator.getProposerDuties.resolves(dutiesBeforeReorg);
    await clock.tickSlotFns(0, controller.signal);

    // Trigger clock onSlot for slot 1 - Return different duties for slot 1
    api.validator.getProposerDuties.resolves(dutiesAfterReorg);
    await clock.tickSlotFns(1, controller.signal);

    // Should persist the dutiesAfterReorg
    expect(Object.fromEntries(dutiesService["proposers"])).to.deep.equal(
      {0: dutiesAfterReorg},
      "dutiesService.proposers must persist dutiesAfterReorg"
    );

    expect(notifyBlockProductionFn.callCount).to.equal(
      2,
      "Must call notifyBlockProductionFn twice, before and after the re-org"
    );

    expect(notifyBlockProductionFn.getCall(0).args).to.deep.equal(
      [1, [pubkeys[0]]],
      "First call to notifyBlockProductionFn() before the re-org with pubkey[0]"
    );
    expect(notifyBlockProductionFn.getCall(1).args).to.deep.equal(
      [1, [pubkeys[1]]],
      "Second call to notifyBlockProductionFn() after the re-org with pubkey[1]"
    );
  });

  it("Should remove signer from duty", async function () {
    // Reply with some duties
    const slot = 0; // genesisTime is right now, so test with slot = currentSlot
    const duties: ProposerDutiesRes = {
      dependentRoot: ZERO_HASH,
      data: [
        {slot: slot, validatorIndex: 0, pubkey: pubkeys[0]},
        {slot: slot, validatorIndex: 1, pubkey: pubkeys[1]},
        {slot: 33, validatorIndex: 2, pubkey: pubkeys[2]},
      ],
    };

    const dutiesRemoved: ProposerDutiesRes = {
      dependentRoot: ZERO_HASH,
      data: [
        {slot: slot, validatorIndex: 1, pubkey: pubkeys[1]},
        {slot: 33, validatorIndex: 2, pubkey: pubkeys[2]},
      ],
    };
    api.validator.getProposerDuties.resolves(duties);

    const notifyBlockProductionFn = sinon.stub(); // Returns void

    const clock = new ClockMock();
    const dutiesService = new BlockDutiesService(loggerVc, api, clock, validatorStore, notifyBlockProductionFn);

    // Trigger clock onSlot for slot 0
    await clock.tickSlotFns(0, controller.signal);
    await clock.tickSlotFns(32, controller.signal);

    // first confirm the duties for the epochs was persisted
    expect(Object.fromEntries(dutiesService["proposers"])).to.deep.equal(
      {0: duties, 1: duties},
      "Wrong dutiesService.proposers Map"
    );

    // then remove a signers public key
    dutiesService.removeDutiesForKey(toHexString(pubkeys[0]));

    // confirm that the duties no longer contain the signers public key
    expect(Object.fromEntries(dutiesService["proposers"])).to.deep.equal(
      {0: dutiesRemoved, 1: dutiesRemoved},
      "Wrong dutiesService.proposers Map"
    );
  });
});
