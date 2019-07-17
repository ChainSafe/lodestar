import {expect} from "chai";
import {Keypair} from "@chainsafe/bls-js/lib/keypair";
import Validator from "../../../src/validator";
import {RpcClientOverInstance} from "../../../src/validator/rpc";
import {MockBeaconApi} from "../../utils/mocks/rpc/beacon";
import {MockValidatorApi} from "../../utils/mocks/rpc/validator";
import {ILogger, WinstonLogger} from "../../../src/logger";
import {IValidatorOptions} from "../../../src/validator/options";
import {createIBeaconConfig} from "../../../src/config";
import * as mainnetParams from "../../../src/params/presets/mainnet";

describe('Validator', () => {
  let logger: ILogger = new WinstonLogger();
  let config = createIBeaconConfig(mainnetParams);


  before(async () => {
    logger.silent(true);
  });

  after(async () => {
    logger.silent(false);
  });

  it('Should be able to connect with the beacon chain', async () => {
    const rpcClient = new RpcClientOverInstance({
      config,
      beacon: new MockBeaconApi({
        genesisTime: Date.now() / 1000
      }),
      validator: new MockValidatorApi(),
    });

    let validatorCtx: Partial<IValidatorOptions> = {
      rpcInstance: rpcClient,
      keypair: Keypair.generate(),
    };

    let validator = new Validator(validatorCtx, {config, logger});
    await expect(validator.start()).to.not.throw;
    await validator.stop();
  });

});
