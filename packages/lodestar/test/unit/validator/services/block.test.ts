import BlockProposingService from "../../../../src/validator/services/block";
import {PrivateKey} from "@chainsafe/bls-js/lib/privateKey";
import {RpcClientOverInstance} from "../../../../src/validator/rpc";
import sinon from "sinon";
import {generateFork} from "../../../utils/fork";
import {expect} from "chai";
import {ValidatorApi} from "../../../../src/rpc/api/validator";
import {generateEmptyBlock} from "../../../utils/block";
import {generateState} from "../../../utils/state";
import {BeaconApi} from "../../../../src/rpc/api/beacon";
import {SLOTS_PER_EPOCH} from "@chainsafe/eth2-types";
import {ValidatorDB} from "../../../../src/db/api";
import {ILogger, WinstonLogger} from "../../../../src/logger";

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
      0, rpcClientStub, PrivateKey.random(), dbStub, logger
    );
    const result = await service.createAndPublishBlock(1, generateFork());
    expect(result).to.be.null;
  });

  it('should produce correct block - last signed is null', async function () {
    const slot = 2;
    rpcClientStub.validator = sandbox.createStubInstance(ValidatorApi);
    rpcClientStub.beacon = sandbox.createStubInstance(BeaconApi);
    rpcClientStub.validator.produceBlock.withArgs(slot, sinon.match.any).resolves(generateEmptyBlock());
    rpcClientStub.beacon.getBeaconState.resolves(generateState({slot: SLOTS_PER_EPOCH * 2}));
    dbStub.getBlock.resolves(null);
    const service = new BlockProposingService(
      0, rpcClientStub, PrivateKey.random(), dbStub, logger
    );
    const result = await service.createAndPublishBlock(slot, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });

  it('should produce correct block - last signed in previous epoch', async function () {
    const slot = SLOTS_PER_EPOCH;
    rpcClientStub.validator = sandbox.createStubInstance(ValidatorApi);
    rpcClientStub.beacon = sandbox.createStubInstance(BeaconApi);
    rpcClientStub.validator.produceBlock.withArgs(slot, sinon.match.any).resolves(generateEmptyBlock());
    rpcClientStub.beacon.getBeaconState.resolves(generateState({slot: SLOTS_PER_EPOCH * 2}));
    dbStub.getBlock.resolves(generateEmptyBlock());
    const service = new BlockProposingService(
      0, rpcClientStub, PrivateKey.random(), dbStub, logger
    );
    const result = await service.createAndPublishBlock(slot, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });

});
