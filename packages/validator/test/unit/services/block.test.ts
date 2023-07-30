import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {config as mainnetConfig} from "@lodestar/config/default";
import {sleep} from "@lodestar/utils";
import {ssz} from "@lodestar/types";
import {HttpStatusCode} from "@lodestar/api";
import {BlockProposingService} from "../../../src/services/block.js";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {loggerVc} from "../../utils/logger.js";
import {ClockMock} from "../../utils/clock.js";
import {ZERO_HASH_HEX} from "../../utils/types.js";

describe("BlockDutiesService", function () {
  const sandbox = sinon.createSandbox();

  const api = getApiClientStub(sandbox);
  const validatorStore = sinon.createStubInstance(ValidatorStore) as ValidatorStore &
    sinon.SinonStubbedInstance<ValidatorStore>;
  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  const config = createChainForkConfig(mainnetConfig);

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
    api.validator.getProposerDuties.resolves({
      response: {
        dependentRoot: ZERO_HASH_HEX,
        executionOptimistic: false,
        data: [{slot: slot, validatorIndex: 0, pubkey: pubkeys[0]}],
      },
      ok: true,
      status: HttpStatusCode.OK,
    });

    const clock = new ClockMock();
    const blockService = new BlockProposingService(config, loggerVc, api, clock, validatorStore, null);

    const signedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    validatorStore.signRandao.resolves(signedBlock.message.body.randaoReveal);
    validatorStore.signBlock.callsFake(async (_, block) => ({message: block, signature: signedBlock.signature}));
    api.validator.produceBlock.resolves({
      response: {data: signedBlock.message, blockValue: ssz.Wei.defaultValue()},
      ok: true,
      status: HttpStatusCode.OK,
    });
    api.beacon.publishBlock.resolves();

    // Trigger block production for slot 1
    const notifyBlockProductionFn = blockService["dutiesService"]["notifyBlockProductionFn"];
    notifyBlockProductionFn(1, [pubkeys[0]]);

    // Resolve all promises
    await sleep(20, controller.signal);

    // Must have submitted the block received on signBlock()
    expect(api.beacon.publishBlock.callCount).to.equal(1, "publishBlock() must be called once");
    expect(api.beacon.publishBlock.getCall(0).args).to.deep.equal([signedBlock], "wrong publishBlock() args");
  });
});
