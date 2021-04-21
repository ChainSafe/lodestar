import {AbortController} from "abort-controller";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {phase0, Root} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {generateEmptySignedBlock} from "@chainsafe/lodestar/test/utils/block";
import {BlockProposingService} from "../../../src/services/block";
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

  it("Should produce, sign, and publish a block", async function () {
    // Reply with some duties
    const slot = 0; // genesisTime is right now, so test with slot = currentSlot
    const duties: ProposerDutiesRes = {
      dependentRoot: ZERO_HASH,
      data: [{slot: slot, validatorIndex: 0, pubkey: pubkeys[0]}],
    };
    apiClient.validator.getProposerDuties.resolves(duties);

    // Clock will call runAttesterDutiesTasks() immediatelly
    const clock = new Clock(config, logger, {genesisTime: Date.now() / 1000});
    const blockService = new BlockProposingService(config, logger, apiClient, clock, validatorStore);

    const signedBlock = generateEmptySignedBlock();
    validatorStore.randaoReveal.resolves(signedBlock.message.body.randaoReveal);
    validatorStore.signBlock.callsFake(async (_, block) => ({message: block, signature: signedBlock.signature}));
    apiClient.validator.produceBlock.resolves(signedBlock.message);
    apiClient.beacon.blocks.publishBlock.resolves();

    // Triger block production for slot 1
    const notifyBlockProductionFn = blockService["dutiesService"]["notifyBlockProductionFn"];
    notifyBlockProductionFn(1, [pubkeys[0]]);

    // Resolve all promises
    await sleep(20, controller.signal);

    // Must have submited the block received on signBlock()
    expect(apiClient.beacon.blocks.publishBlock.callCount).to.equal(1, "publishBlock() must be called once");
    expect(apiClient.beacon.blocks.publishBlock.getCall(0).args).to.deep.equal(
      [signedBlock],
      "wrong publishBlock() args"
    );
  });
});
