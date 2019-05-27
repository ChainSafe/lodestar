import logger from "../../../src/logger";
import {expect} from "chai";
import Validator from "../../../src/validator";
import {ValidatorCtx} from "../../../src/validator/types";
import {RpcClient, RpcClientOverInstance} from "../../../src/validator/rpc";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import {MockBeaconApi} from "../../utils/mocks/rpc/beacon";
import {MockValidatorApi} from "../../utils/mocks/rpc/validator";

describe('Validator', () => {
  let sandbox;
  let db: any = {};

  before(async () => {
    // logger.silent(true);
  });

  after(async () => {
    logger.silent(false);
  });

  it('Should be able to connect with the beacon chain', async () => {
    const rpcClient = new RpcClientOverInstance({
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: new MockValidatorApi(),
    });

    let validatorCtx: ValidatorCtx = {
      rpc: rpcClient,
      keypair: Keypair.generate(),
    };

    let validator = new Validator(validatorCtx);
    await expect(validator.setup()).to.not.throw;
  });

});
