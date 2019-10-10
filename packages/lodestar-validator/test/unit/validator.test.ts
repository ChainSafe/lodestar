import {expect} from "chai";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {describe, it} from "mocha";
import {WinstonLogger} from "@chainsafe/lodestar/lib/logger";
import sinon from "sinon";
import {ApiClientOverInstance} from "../../src/api";
import {MockBeaconApi} from "../utils/mocks/beacon";
import {MockValidatorApi} from "../utils/mocks/validator";
import {IValidatorOptions,Validator} from "../../src";
import {ValidatorDB} from "@chainsafe/lodestar/lib/db";

describe("Validator", () => {

  it("Should be able to connect with the beacon chain", async () => {
    const apiClient = new ApiClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: new MockValidatorApi(),
    });

    const validatorCtx: IValidatorOptions = {
      api: apiClient,
      keypair: Keypair.generate(),
      config,
      db: sinon.createStubInstance(ValidatorDB),
      logger: sinon.createStubInstance(WinstonLogger)
    };

    const validator = new Validator(validatorCtx);
    const runSpy = sinon.spy(validator, "run");
    await expect(validator.start()).to.not.throw;
    setTimeout(async () => validator.stop(), 1100);
    setTimeout(() => expect(runSpy.calledOnce).to.be.true, 1100);
  });

});
