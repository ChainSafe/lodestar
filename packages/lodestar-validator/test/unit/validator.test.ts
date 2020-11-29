import {expect} from "chai";
import bls from "@chainsafe/bls";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import sinon from "sinon";
import {ApiClientOverInstance} from "../../src/api";
import {MockBeaconApi} from "../utils/mocks/beacon";
import {MockValidatorApi} from "../utils/mocks/validator";
import {IValidatorOptions, SlashingProtection, Validator} from "../../src";
import {MockNodeApi} from "../utils/mocks/node";
import {silentLogger} from "../utils/logger";
import {RestEventsApi} from "../../src/api/impl/rest/events/events";

describe("Validator", () => {
  it.skip("Should be able to connect with the beacon chain", async () => {
    const apiClient = new ApiClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Math.floor(Date.now() / 1000),
      }),
      node: new MockNodeApi(),
      events: sinon.createStubInstance(RestEventsApi),
      validator: new MockValidatorApi(),
    });

    const privateKey = bls.PrivateKey.fromKeygen();
    const publicKey = privateKey.toPublicKey();

    const validatorCtx: IValidatorOptions = {
      api: apiClient,
      keypairs: [{privateKey, publicKey}],
      config,
      slashingProtection: sinon.createStubInstance(SlashingProtection),
      logger: silentLogger,
    };

    const validator = new Validator(validatorCtx);
    const runSpy = sinon.spy(validator, "run");

    await validator.start();
    await validator.stop();
    expect(runSpy.calledOnce).to.be.true;
  });
});
