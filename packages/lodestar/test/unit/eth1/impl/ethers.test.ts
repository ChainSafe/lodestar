import {afterEach, beforeEach, describe, it} from "mocha";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {Contract, ethers} from "ethers";
import sinon, {SinonStubbedInstance} from "sinon";
import {Block, JsonRpcProvider} from "ethers/providers";

import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

import {EthersEth1Notifier} from "../../../../src/eth1";
import defaults from "../../../../src/eth1/dev/options";

chai.use(chaiAsPromised);

describe("Eth1Notifier", () => {
  const sandbox = sinon.createSandbox();
  const logger: ILogger = new WinstonLogger();
  let contract: SinonStubbedInstance<ethers.Contract>;
  let provider: SinonStubbedInstance<JsonRpcProvider>;
  let eth1: EthersEth1Notifier;

  beforeEach(async function (): Promise<void> {
    logger.silent = true;
    contract = sandbox.createStubInstance(Contract) as any;
    provider = sandbox.createStubInstance(JsonRpcProvider) as any;
    eth1 = new EthersEth1Notifier({
      ...defaults,
      contract: contract as any,
      providerInstance: provider as any,
    },
    {
      config,
      logger,
    });
  });

  afterEach(async () => {
    sandbox.restore();
    logger.silent = false;
  });

  it("should start/stop notifier", async function (): Promise<void> {
    const lastProcessedEth1Data = {
      blockHash: Buffer.alloc(32, 1),
      depositRoot: Buffer.alloc(32, 2),
      depositCount: 5,
    };
    const lastProcessedBlock = {
      number: 5000000,
    } as Block;
    const currentBlockNumber = lastProcessedBlock.number;


    provider.getBlock.withArgs(toHexString(lastProcessedEth1Data.blockHash)).resolves(lastProcessedBlock);
    provider.getBlockNumber.resolves(currentBlockNumber);

    await eth1.start();
    await eth1.stop();
  });

  it("should fail to start because there isn't contract at given address", async function (): Promise<void> {
    eth1 = new EthersEth1Notifier({
      ...defaults,
      providerInstance: provider as any,
    }, {
      config,
      logger,
    });
    await expect(
      eth1.start()
    ).to.be.rejectedWith("There is no deposit contract at given address");
  });

  it("should get block by hash", async function (): Promise<void> {
    provider.getBlock.withArgs(0, false).resolves({} as Block);
    let block = await eth1.getBlock(0);
    block = await eth1.getBlock(block.hash);
    expect(block).to.not.be.null;
  });

  it("should get deposit events from a block", async () => {
    provider.getLogs.resolves([]);
    // @ts-ignore
    contract.interface = sandbox.stub();
    // @ts-ignore
    contract.interface.parseLog = sandbox.stub().resolves({
      values: [{
        index: toHexString(Buffer.alloc(8)),
        pubkey: toHexString(Buffer.alloc(48)),
        withdrawalCredentials: toHexString(Buffer.alloc(32)),
        amount: toHexString(Buffer.alloc(8)),
        signature: toHexString(Buffer.alloc(96)),
      }],
    });
    // @ts-ignore
    contract.interface.events = {
      DepositEvent: {
        topic: ""
      }
    };
    expect(
      await eth1.getDepositEvents(0)
    ).to.not.be.null;
  });
});
