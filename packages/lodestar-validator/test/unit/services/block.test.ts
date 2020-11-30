import bls from "@chainsafe/bls";
import {ZERO_HASH} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {generateEmptyBlock, generateEmptySignedBlock} from "@chainsafe/lodestar/test/utils/block";
import {toBufferBE} from "bigint-buffer";
import {expect} from "chai";
import sinon from "sinon";
import {InvalidBlockError, InvalidBlockErrorCode, SlashingProtection} from "../../../src";
import BlockProposingService from "../../../src/services/block";
import {SinonStubbedApi} from "../../utils/apiStub";
import {generateFork} from "../../utils/fork";
import {silentLogger} from "../../utils/logger";

describe("block proposing service", function () {
  const sandbox = sinon.createSandbox();

  let rpcClientStub: SinonStubbedApi;
  let slashingProtectionStub: sinon.SinonStubbedInstance<SlashingProtection>;
  const logger = silentLogger;

  beforeEach(() => {
    rpcClientStub = new SinonStubbedApi(sandbox);
    slashingProtectionStub = sandbox.createStubInstance(SlashingProtection);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should not produce block in same slot", async function () {
    const secretKey = bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32));
    const publicKey = secretKey.toPublicKey();
    const keypair = {secretKey, publicKey};

    const lastBlock = generateEmptySignedBlock();
    lastBlock.message.slot = 1;

    // Simulate a double vote detection
    slashingProtectionStub.checkAndInsertBlockProposal.rejects(
      new InvalidBlockError({code: InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL} as any)
    );

    const service = new BlockProposingService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    const result = await service.createAndPublishBlock(0, 1, generateFork(), ZERO_HASH);
    expect(result).to.be.null;
  });

  it("should produce correct block - last signed is null", async function () {
    const secretKey = bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32));
    const publicKey = secretKey.toPublicKey();
    const keypair = {secretKey, publicKey};

    const slot = 2;
    rpcClientStub.beacon.blocks.publishBlock = sandbox.stub();
    rpcClientStub.validator.produceBlock.resolves(generateEmptyBlock());

    slashingProtectionStub.checkAndInsertBlockProposal.resolves();

    const service = new BlockProposingService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    const result = await service.createAndPublishBlock(0, slot, generateFork(), ZERO_HASH);
    expect(result).to.not.be.null;
    expect(rpcClientStub.beacon.blocks.publishBlock.calledOnce).to.be.true;
  });

  it("should produce correct block - last signed in previous epoch", async function () {
    const secretKey = bls.SecretKey.fromBytes(toBufferBE(BigInt(98), 32));
    const publicKey = secretKey.toPublicKey();
    const keypair = {secretKey, publicKey};

    const slot = config.params.SLOTS_PER_EPOCH;
    rpcClientStub.validator.produceBlock = sandbox.stub();
    rpcClientStub.beacon.blocks.publishBlock = sandbox.stub();
    rpcClientStub.validator.produceBlock.resolves(generateEmptyBlock());

    slashingProtectionStub.checkAndInsertBlockProposal.resolves();

    const service = new BlockProposingService(config, [keypair], rpcClientStub, slashingProtectionStub, logger);
    const result = await service.createAndPublishBlock(0, slot, generateFork(), ZERO_HASH);
    expect(result).to.not.be.null;
    expect(rpcClientStub.beacon.blocks.publishBlock.calledOnce).to.be.true;
  });
});
