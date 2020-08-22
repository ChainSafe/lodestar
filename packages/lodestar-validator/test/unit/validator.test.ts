import {expect} from "chai";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import sinon from "sinon";
import {ApiClientOverInstance} from "../../src/api";
import {MockBeaconApi} from "../utils/mocks/beacon";
import {MockValidatorApi} from "../utils/mocks/validator";
import {IValidatorOptions, Validator} from "../../src";
import {MockValidatorDB} from "../utils/mocks/MockValidatorDB";
import {MockNodeApi} from "../utils/mocks/node";

describe("Validator", () => {
  it.skip("Should be able to connect with the beacon chain", async () => {
    const apiClient = new ApiClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Math.floor(Date.now() / 1000),
      }),
      node: new MockNodeApi(),
      validator: new MockValidatorApi(),
    });

    const validatorCtx: IValidatorOptions = {
      api: apiClient,
      keypairs: [Keypair.generate()],
      config,
      db: sinon.createStubInstance(MockValidatorDB),
      logger: sinon.createStubInstance(WinstonLogger),
    };

    const validator = new Validator(validatorCtx);
    const runSpy = sinon.spy(validator, "run");

    await validator.start();
    await validator.stop();
    expect(runSpy.calledOnce).to.be.true;
  });
});
