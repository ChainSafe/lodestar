import {afterEach, beforeEach, describe, it} from "mocha";
import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {Contract, ethers} from "ethers";
import sinon, {SinonStubbedInstance} from "sinon";

import {toHexString} from "@chainsafe/ssz";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";

import {EthersEth1Notifier, Eth1Block} from "../../../../src/eth1";
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
    await Promise.resolve();
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
      // @ts-ignore
      eth1.startProcessEth1Blocks()
    ).to.be.rejectedWith("There is no deposit contract at given address");
  });

  it("should get block by hash", async function (): Promise<void> {
    provider.getBlock.withArgs(0).resolves({} as ethers.providers.Block);
    let block = await eth1.getBlock(0);
    block = await eth1.getBlock(block.hash);
    expect(block).to.not.be.null;
  });

  it("should set checkpoints correctly - correct SECONDS_PER_ETH1_BLOCK", () => {
    // initially preGenesisCheckpoint is undefined
    expect(eth1.passCheckpoint(3001)).to.be.true;
    const setCheckpoint = (blockNumber: number): void => {
      // assuming 3000 is genesis, this is 1000 blocks to genesis
      eth1.setCheckpoint({number: blockNumber, timestamp:
        (config.params.MIN_GENESIS_TIME - config.params.GENESIS_DELAY) - (3000 - blockNumber) * config.params.SECONDS_PER_ETH1_BLOCK} as Eth1Block);
    };
    const expectCheckpoint = (blockNumber: number): void => {
      expect(eth1.passCheckpoint(blockNumber - 1)).to.be.false;
      expect(eth1.passCheckpoint(blockNumber)).to.be.true;
    };
    // assuming 3000 is genesis, this is 1000 blocks to genesis
    setCheckpoint(2000);
    expectCheckpoint(2500);
    setCheckpoint(2500);
    expectCheckpoint(2750);
    setCheckpoint(2750);
    expectCheckpoint(2875);
    setCheckpoint(2875);
    expectCheckpoint(2937);
    setCheckpoint(2937);
    expectCheckpoint(2968);
    setCheckpoint(2968);
    expectCheckpoint(2984);
    setCheckpoint(2984);
    expectCheckpoint(2992);
    setCheckpoint(2992);
    expectCheckpoint(2996);
    setCheckpoint(2996);
    // checkpoint 2996 + 2 = 2998 -> set undefined
    expect(eth1.passCheckpoint(2997)).to.be.false;
    // <= 2 blocks to genesis
    expect(eth1.passCheckpoint(2998)).to.be.true;
    expect(eth1.passCheckpoint(2999)).to.be.true;
    expect(eth1.passCheckpoint(3000)).to.be.true;
  });

  it("should set checkpoints correctly - eth1 runs faster than expected", () => {
    const secPerBlock = config.params.SECONDS_PER_ETH1_BLOCK - 2;
    // initially preGenesisCheckpoint is undefined
    expect(eth1.passCheckpoint(3001)).to.be.true;
    const setCheckpoint = (blockNumber: number): void => {
      // assuming 3000 is genesis, this is 1000 blocks to genesis
      eth1.setCheckpoint({number: blockNumber, timestamp:
        (config.params.MIN_GENESIS_TIME - config.params.GENESIS_DELAY) - (3000 - blockNumber) * secPerBlock} as Eth1Block);
    };
    const expectCheckpoint = (blockNumber: number): void => {
      expect(eth1.passCheckpoint(blockNumber - 1)).to.be.false;
      expect(eth1.passCheckpoint(blockNumber)).to.be.true;
    };
    setCheckpoint(2000);
    expectCheckpoint(2428);
    setCheckpoint(2428);
    expectCheckpoint(2673);
    setCheckpoint(2673);
    expectCheckpoint(2813);
    setCheckpoint(2813);
    expectCheckpoint(2893);
    setCheckpoint(2893);
    expectCheckpoint(2938);
    setCheckpoint(2938);
    expectCheckpoint(2964);
    setCheckpoint(2964);
    expectCheckpoint(2979);
    setCheckpoint(2979);
    expectCheckpoint(2988);
    setCheckpoint(2988);
    expectCheckpoint(2993);
    setCheckpoint(2993);
    expectCheckpoint(2996);
    setCheckpoint(2996);
    expectCheckpoint(2997);
    setCheckpoint(2997);
    expect(eth1.passCheckpoint(2998)).to.be.true;
    expect(eth1.passCheckpoint(2999)).to.be.true;
    expect(eth1.passCheckpoint(3000)).to.be.true;
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
