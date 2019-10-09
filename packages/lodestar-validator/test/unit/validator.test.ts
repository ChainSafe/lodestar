import {expect} from "chai";
import {Keypair} from "@chainsafe/bls/lib/keypair";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {describe, it} from "mocha";
import {WinstonLogger} from "@chainsafe/lodestar/lib/logger";
import sinon from "sinon";
import {RpcClientOverInstance} from "../../src/rpc";
import {MockBeaconApi} from "../utils/mocks/beacon";
import {MockValidatorApi} from "../utils/mocks/validator";
import {IValidatorOptions} from "../../src/options";
import Validator from "../../src";
import {ValidatorDB} from "@chainsafe/lodestar/lib/db";

describe("Validator", () => {

  const logger: any = sinon.createStubInstance(WinstonLogger);

  it("Should be able to connect with the beacon chain", async () => {
    const rpcClient = new RpcClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: new MockValidatorApi(),
    });

    const validatorCtx: IValidatorOptions = {
      config,
      db: sinon.createStubInstance(ValidatorDB),
      logger,
      api: rpcClient,
      keypair: Keypair.generate()
    };

    const validator = new Validator(validatorCtx);
    await expect(validator.start()).to.not.throw;
    await validator.stop();
  });

});
