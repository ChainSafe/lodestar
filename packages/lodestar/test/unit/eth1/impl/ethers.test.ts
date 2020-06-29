import {afterEach, beforeEach, describe, it} from "mocha";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {Contract, ethers} from "ethers";
import sinon, {SinonStubbedInstance} from "sinon";

import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

import {EthersEth1Notifier} from "../../../../src/eth1";
import defaults from "../../../../src/eth1/dev/options";
import {StubbedBeaconDb} from "../../../utils/stub";

chai.use(chaiAsPromised);

describe("Eth1Notifier", () => {
  const sandbox = sinon.createSandbox();
  const logger: ILogger = new WinstonLogger();
  let contract: SinonStubbedInstance<ethers.Contract>;
  let provider: SinonStubbedInstance<ethers.providers.JsonRpcProvider>;
  let db: StubbedBeaconDb;
  let eth1: EthersEth1Notifier;

  beforeEach(async function (): Promise<void> {
    logger.silent = true;
    contract = sandbox.createStubInstance(Contract) as any;
    provider = sandbox.createStubInstance(ethers.providers.JsonRpcProvider) as any;
    db = new StubbedBeaconDb(sandbox);
    eth1 = new EthersEth1Notifier({
      ...defaults,
      contract: contract as any,
      providerInstance: provider as any,
    },
    {
      config,
      db,
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
    } as ethers.providers.Block;
    const currentBlockNumber = lastProcessedBlock.number;
    db.eth1Data.lastValue.resolves(lastProcessedEth1Data);


    provider.getBlock.withArgs(toHexString(lastProcessedEth1Data.blockHash)).resolves(lastProcessedBlock);
    provider.getBlockNumber.resolves(currentBlockNumber);

    await eth1.start();
    expect(provider.getBlock.withArgs(toHexString(lastProcessedEth1Data.blockHash)).calledOnce).to.be.true;
    await eth1.stop();
  });

  it("should start eth1 to build genesis even it's disabled", async () => {
    eth1 = new EthersEth1Notifier({
      ...defaults,
      enabled: false,
      contract: contract as any,
      providerInstance: provider as any,
    },
    {
      config,
      db,
      logger,
    });
    await eth1.start();
    expect(provider.getBlock.called).to.be.false;
    // cannot start if subscribe=false
    await eth1.start();
    expect(provider.getBlock.called).to.be.false;
    // should start if subscribe=true
    const lastProcessedEth1Data = {
      blockHash: Buffer.alloc(32, 1),
      depositRoot: Buffer.alloc(32, 2),
      depositCount: 5,
    };
    const lastProcessedBlock = {
      number: 5000000,
    } as ethers.providers.Block;
    const currentBlockNumber = lastProcessedBlock.number;
    db.eth1Data.lastValue.resolves(lastProcessedEth1Data);
    provider.getBlock.withArgs(toHexString(lastProcessedEth1Data.blockHash)).resolves(lastProcessedBlock);
    provider.getBlockNumber.resolves(currentBlockNumber);
    const eth1Source = await eth1.getEth1BlockAndDepositEventsSource();
    expect(eth1Source).not.to.be.undefined;
    await new Promise((resolve) => {
      provider.getBlockNumber.callsFake(async () => {
        resolve();
        return 0;
      });
    });
    expect(provider.getBlock.withArgs(toHexString(lastProcessedEth1Data.blockHash)).calledOnce).to.be.true;

    await eth1.endEth1BlockAndDepositEventsSource();
    // make sure stop() is called
    expect(provider.removeAllListeners.calledOnce).to.be.true;
  });

  it("should fail to start because there isn't contract at given address", async function (): Promise<void> {
    eth1 = new EthersEth1Notifier({
      ...defaults,
      providerInstance: provider as any,
    }, {
      config,
      db,
      logger,
    });
    await expect(
      eth1.start()
    ).to.be.rejectedWith("There is no deposit contract at given address");
  });

  it("should get block by hash", async function (): Promise<void> {
    provider.getBlock.withArgs(0).resolves({} as ethers.providers.Block);
    let block = await eth1.getBlock(0);
    block = await eth1.getBlock(block.hash);
    expect(block).to.not.be.null;
  });

  it.skip("should get deposit events from a block", async () => {
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
