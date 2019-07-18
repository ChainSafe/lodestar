import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import sinon from "sinon";
import {expect} from "chai";

import {config} from "../../../../src/config/presets/mainnet";
import BlockProposingService from "../../../../src/validator/services/block";
import {RpcClientOverInstance} from "../../../../src/validator/rpc";
import {ValidatorApi} from "../../../../src/rpc/api/validator";
import {BeaconApi} from "../../../../src/rpc/api/beacon";
import {ValidatorDB} from "../../../../src/db/api";
import {ILogger, WinstonLogger} from "../../../../src/logger";
import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {generateFork} from "../../../utils/fork";

describe('block proposing service', function () {

  const sandbox = sinon.createSandbox();

  let rpcClientStub, dbStub;
  let logger: ILogger = new WinstonLogger();

  before(() => {
    logger.silent(true);
  });

  beforeEach(() => {
    rpcClientStub = sandbox.createStubInstance(RpcClientOverInstance);
    dbStub = sandbox.createStubInstance(ValidatorDB);
  });

  afterEach(() => {
    sandbox.restore();
  });

  after(() => {
    logger.silent(false);
  });

  it('should not produce block in same epoch', async function () {
    dbStub.getBlock.resolves(generateEmptyBlock());
    const service = new BlockProposingService(
      config, 0, rpcClientStub, PrivateKey.random(), dbStub, logger
    );
    const result = await service.createAndPublishBlock(1, generateFork());
    expect(result).to.be.null;
  });

  it('should produce correct block - last signed is null', async function () {
    const slot = 2;
    rpcClientStub.validator = sandbox.createStubInstance(ValidatorApi);
    rpcClientStub.beacon = sandbox.createStubInstance(BeaconApi);
    rpcClientStub.validator.produceBlock.withArgs(slot, sinon.match.any).resolves(generateEmptyBlock());
    rpcClientStub.beacon.getBeaconState.resolves(generateState({slot: config.params.SLOTS_PER_EPOCH * 2}));
    dbStub.getBlock.resolves(null);
    const service = new BlockProposingService(
      config, 0, rpcClientStub, PrivateKey.random(), dbStub, logger
    );
    const result = await service.createAndPublishBlock(slot, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });

  it('should produce correct block - last signed in previous epoch', async function () {
    const slot = config.params.SLOTS_PER_EPOCH;
    rpcClientStub.validator = sandbox.createStubInstance(ValidatorApi);
    rpcClientStub.beacon = sandbox.createStubInstance(BeaconApi);
    rpcClientStub.validator.produceBlock.withArgs(slot, sinon.match.any).resolves(generateEmptyBlock());
    rpcClientStub.beacon.getBeaconState.resolves(generateState({slot: config.params.SLOTS_PER_EPOCH * 2}));
    dbStub.getBlock.resolves(generateEmptyBlock());
    const service = new BlockProposingService(
      config, 0, rpcClientStub, PrivateKey.random(), dbStub, logger
    );
    const result = await service.createAndPublishBlock(slot, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });

});
