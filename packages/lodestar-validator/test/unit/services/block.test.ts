import sinon from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {Keypair} from "@chainsafe/bls";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {ApiClientOverInstance} from "../../../src/api";
import {generateEmptySignedBlock, generateEmptyBlock} from "@chainsafe/lodestar/test/utils/block";
import BlockProposingService from "../../../src/services/block";
import {generateFork} from "../../utils/fork";
import {MockValidatorDB} from "../../utils/mocks/MockValidatorDB";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";

describe("block proposing service", function () {
  const sandbox = sinon.createSandbox();

  let rpcClientStub: any, dbStub: any, logger: any;

  beforeEach(() => {
    rpcClientStub = sandbox.createStubInstance(ApiClientOverInstance);
    dbStub = sandbox.createStubInstance(MockValidatorDB);
    logger = sandbox.createStubInstance(WinstonLogger);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should not produce block in same slot", async function () {
    const lastBlock = generateEmptySignedBlock();
    lastBlock.message.slot = 1;
    dbStub.getBlock.resolves(lastBlock);
    const service = new BlockProposingService(config, [Keypair.generate()], rpcClientStub, dbStub, logger);
    const result = await service.createAndPublishBlock(0, 1, generateFork(), ZERO_HASH);
    expect(result).to.be.null;
  });

  it("should produce correct block - last signed is null", async function () {
    const slot = 2;
    rpcClientStub.validator = {
      produceBlock: sandbox.stub(),
      publishBlock: sandbox.stub(),
    };
    rpcClientStub.validator.produceBlock.withArgs(slot, sinon.match.any).resolves(generateEmptyBlock());
    dbStub.getBlock.resolves(null);
    const service = new BlockProposingService(config, [Keypair.generate()], rpcClientStub, dbStub, logger);
    const result = await service.createAndPublishBlock(0, slot, generateFork(), ZERO_HASH);
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });

  it("should produce correct block - last signed in previous epoch", async function () {
    const slot = config.params.SLOTS_PER_EPOCH;
    rpcClientStub.validator = {
      produceBlock: sandbox.stub(),
      publishBlock: sandbox.stub(),
    };
    rpcClientStub.validator.produceBlock
      .withArgs(slot, sinon.match.any, sinon.match.any)
      .resolves(generateEmptyBlock());
    dbStub.getBlock.resolves(generateEmptySignedBlock());
    const service = new BlockProposingService(config, [Keypair.generate()], rpcClientStub, dbStub, logger as ILogger);
    const result = await service.createAndPublishBlock(0, slot, generateFork(), ZERO_HASH);
    expect(result).to.not.be.null;
    expect(rpcClientStub.validator.publishBlock.calledOnce).to.be.true;
  });
});
