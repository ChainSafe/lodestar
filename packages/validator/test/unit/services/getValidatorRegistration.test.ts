import {expect} from "chai";
import sinon from "sinon";
import bls from "@chainsafe/bls";
import {toHexString, fromHexString} from "@chainsafe/ssz";
import {chainConfig} from "@lodestar/config/default";
import {ValidatorStore} from "../../../src/services/validatorStore.js";
import {getApiClientStub} from "../../utils/apiStub.js";
import {initValidatorStore} from "../../utils/validatorStore.js";

describe("getValidatorRegistration", function () {
  const sandbox = sinon.createSandbox();
  const api = getApiClientStub(sandbox);

  let pubkeys: string[]; // Initialize pubkeys in before() so bls is already initialized
  let validatorStore: ValidatorStore;
  let signValidatorStub: sinon.SinonStub<any>;

  before(() => {
    const secretKeys = Array.from({length: 1}, (_, i) => bls.SecretKey.fromBytes(Buffer.alloc(32, i + 1)));
    pubkeys = secretKeys.map((sk) => toHexString(sk.toPublicKey().toBytes()));

    validatorStore = initValidatorStore(secretKeys, api, chainConfig);

    signValidatorStub = sinon.stub(validatorStore, "signValidatorRegistration").resolves({
      message: {
        feeRecipient: fromHexString("0x00"),
        gasLimit: 10000,
        timestamp: Date.now(),
        pubkey: fromHexString(pubkeys[0]),
      },
      signature: Buffer.alloc(96, 0),
    });
  });

  after(() => {
    sandbox.restore();
  });

  it("Should update cache and return from cache next time", async () => {
    const slot = 0;
    const val1 = validatorStore.getValidatorRegistration(pubkeys[0], "0x00", slot);
    await new Promise((r) => setTimeout(r, 10));
    expect(validatorStore["validatorRegistrationCache"].has(pubkeys[0])).to.be.true;
    expect(signValidatorStub.callCount).to.equal(1, "signValidatorRegistration() must be called once after 1st call");

    const val2 = validatorStore.getValidatorRegistration(pubkeys[0], "0x00", slot);
    expect(JSON.stringify(val1) === JSON.stringify(val2));
    expect(signValidatorStub.callCount).to.equal(
      1,
      "signValidatorRegistration() must be called once even after 2nd call"
    );

    await validatorStore.getValidatorRegistration(pubkeys[0], "0x10", slot);
    expect(signValidatorStub.callCount).to.equal(2, "signValidatorRegistration() must be called twice");
  });
});
