import {expect} from "chai";
import bls from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/mainnet";
import sinon from "sinon";
import {IValidatorOptions, SlashingProtection, Validator} from "../../src";
import {testLogger} from "../utils/logger";
import {SinonStubbedApi} from "../utils/apiStub";

describe("Validator", () => {
  it.skip("Should be able to connect with the beacon chain", async () => {
    const secretKey = bls.SecretKey.fromKeygen();

    const validatorCtx: IValidatorOptions = {
      api: new SinonStubbedApi(),
      secretKeys: [secretKey],
      config,
      slashingProtection: sinon.createStubInstance(SlashingProtection),
      logger: testLogger(),
    };

    const validator = new Validator(validatorCtx);
    const runSpy = sinon.spy(validator, "run");

    await validator.start();
    await validator.stop();
    expect(runSpy.calledOnce).to.be.true;
  });
});
