import {AbortController} from "@chainsafe/abort-controller";
import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {config as mainnetConfig} from "@chainsafe/lodestar-config/default";
import {Root} from "@chainsafe/lodestar-types";
import {sleep} from "@chainsafe/lodestar-utils";
import {routes} from "@chainsafe/lodestar-api";
import {generateEmptySignedBlock} from "@chainsafe/lodestar/test/utils/block";
import {BlockProposingService} from "../../../src/services/block";
import {ValidatorStore} from "../../../src/services/validatorStore";
import {getApiClientStub} from "../../utils/apiStub";
import {loggerVc} from "../../utils/logger";
import {ClockMock} from "../../utils/clock";

type ProposerDutiesRes = {dependentRoot: Root; data: routes.validator.ProposerDuty[]};

describe("BlockDutiesService", function () {
  const sandbox = sinon.createSandbox();
  const ZERO_HASH = Buffer.alloc(32, 0);

  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const config = createIChainForkConfig(mainnetConfig);

  before(() => {
    const secretKeys = Array.from({length: 2}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
    validatorStore.votingPubkeys.returns(pubkeys.map(toHexString));
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
    api.validator.getProposerDuties.resolves(duties);

    const clock = new ClockMock();
    const blockService = new BlockProposingService(config, loggerVc, api, clock, validatorStore);

    const signedBlock = generateEmptySignedBlock();
    validatorStore.signRandao.resolves(signedBlock.message.body.randaoReveal);
    validatorStore.signBlock.callsFake(async (_, block) => ({message: block, signature: signedBlock.signature}));
    api.validator.produceBlock.resolves({data: signedBlock.message});
    api.beacon.publishBlock.resolves();

    // Triger block production for slot 1
    const notifyBlockProductionFn = blockService["dutiesService"]["notifyBlockProductionFn"];
    notifyBlockProductionFn(1, [pubkeys[0]]);

    // Resolve all promises
    await sleep(20, controller.signal);

    // Must have submited the block received on signBlock()
    expect(api.beacon.publishBlock.callCount).to.equal(1, "publishBlock() must be called once");
    expect(api.beacon.publishBlock.getCall(0).args).to.deep.equal([signedBlock], "wrong publishBlock() args");
  });
});
