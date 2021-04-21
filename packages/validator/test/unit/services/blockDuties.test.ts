import {AbortController} from "abort-controller";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0, Root} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {BlockDutiesService} from "../../../src/services/blockDuties";
import {ValidatorStore} from "../../../src/services/validatorStore";
import {Clock} from "../../../src/util/clock";
import {ApiClientStub} from "../../utils/apiStub";
import {testLogger} from "../../utils/logger";

type ProposerDutiesRes = {dependentRoot: Root; data: phase0.ProposerDuty[]};

describe("BlockDutiesService", function () {
  const sandbox = sinon.createSandbox();
  const logger = testLogger();
  const ZERO_HASH = Buffer.alloc(32, 0);

  const apiClient = ApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  before(() => {
    const secretKeys = Array.from({length: 2}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.returns(pubkeys);
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
    apiClient.validator.getProposerDuties.resolves(duties);

    const notifyBlockProductionFn = sinon.stub(); // Returns void

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new Clock(config, logger, {genesisTime: Date.now() / 1000});
    const dutiesService = new BlockDutiesService(
      config,
      logger,
      apiClient,
      clock,
      validatorStore,
      notifyBlockProductionFn
    );
    clock.start(controller.signal);

    // Resolve all promises
    await sleep(20, controller.signal);

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
    const clock = new Clock(config, logger, {genesisTime: Date.now() / 1000});
    const dutiesService = new BlockDutiesService(
      config,
      logger,
      apiClient,
      clock,
      validatorStore,
      notifyBlockProductionFn
    );

    // Trigger clock onSlot for slot 0
    apiClient.validator.getProposerDuties.resolves(dutiesBeforeReorg);
    for (const fn of clock["fns"]) await fn.fn(0, controller.signal);

    // Trigger clock onSlot for slot 1 - Return different duties for slot 1
    apiClient.validator.getProposerDuties.resolves(dutiesAfterReorg);
    for (const fn of clock["fns"]) await fn.fn(1, controller.signal);

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
});
