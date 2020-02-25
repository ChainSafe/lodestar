import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Keypair} from "@chainsafe/bls";
import {describe, it, beforeEach, afterEach} from "mocha";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ApiClientOverInstance} from "../../../src/api";
import {ValidatorDB} from "@chainsafe/lodestar/lib/db";
import {generateEmptySignedBlock, generateEmptyBlock} from "@chainsafe/lodestar/test/utils/block";
import BlockProposingService from "../../../src/services/block";
import {generateFork} from "@chainsafe/lodestar/test/utils/fork";

describe("block proposing service", function () {

  const sandbox = sinon.createSandbox();

  let rpcClientStub: any, dbStub: any, logger: any;

  beforeEach(() => {
    rpcClientStub = sandbox.createStubInstance(ApiClientOverInstance);
    dbStub = sandbox.createStubInstance(ValidatorDB);
    logger = sandbox.createStubInstance(WinstonLogger);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should not produce block in same epoch", async function () {
    dbStub.getBlock.resolves(generateEmptySignedBlock());
    const service = new BlockProposingService(
      config, Keypair.generate(), rpcClientStub, dbStub, logger
    );
    const result = await service.createAndPublishBlock(1, generateFork());
    expect(result).to.be.null;
  });

  it("should produce correct block - last signed is null", async function () {
    const slot = 2;
    rpcClientStub.validator = {
      produceBlock: sandbox.stub(),
      publishBlock: sandbox.stub(),
    };
    rpcClientStub.validator.produceBlock
      .withArgs(slot, sinon.match.any)
      .resolves(generateEmptyBlock());
    dbStub.getBlock.resolves(null);
    const service = new BlockProposingService(
      config, Keypair.generate(), rpcClientStub, dbStub, logger
    );
    const result = await service.createAndPublishBlock(slot, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });

  it("should produce correct block - last signed in previous epoch", async function () {
    const slot = config.params.SLOTS_PER_EPOCH;
    rpcClientStub.validator = {
      produceBlock: sandbox.stub(),
      publishBlock: sandbox.stub(),
    };
    rpcClientStub.validator.produceBlock.withArgs(slot, sinon.match.any).resolves(generateEmptyBlock());
    dbStub.getBlock.resolves(generateEmptySignedBlock());
    const service = new BlockProposingService(
      config, Keypair.generate(), rpcClientStub, dbStub, logger as ILogger
    );
    const result = await service.createAndPublishBlock(slot, generateFork());
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });

});
