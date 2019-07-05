import {} from "mocha";
import BN from "bn.js";
import chai, {assert, expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {Contract, ethers, Event} from "ethers";
import ganache from "ganache-core";
import sinon from "sinon";
import {Provider} from "ethers/providers";
import promisify from "promisify-es6";
import bls from "@chainsafe/bls-js";
import {serialize} from "@chainsafe/ssz";

import {EthersEth1Notifier} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/defaults";
import {number64} from "@chainsafe/eth2-types";
import {ILogger, WinstonLogger} from "../../../src/logger";
import {OpPool} from "../../../src/opPool";

import {generateDeposit} from "../../utils/deposit";


chai.use(chaiAsPromised);
describe("Eth1Notifier", () => {
  const ganacheProvider = ganache.provider();
  const provider = new ethers.providers.Web3Provider(ganacheProvider);
  let opPool;
  let eth1;
  let sandbox;
  let logger: ILogger = new WinstonLogger();

  before(async function (): Promise<void> {
    logger.silent(true);
    sandbox = sinon.createSandbox();
    opPool = sandbox.createStubInstance(OpPool);
    eth1 = new EthersEth1Notifier({
      depositContract: defaults,
      provider: provider
    },
    {
      opPool,
      logger: logger
    });
  });

  after(async () => {
    sandbox.restore();
    await promisify(ganacheProvider.close)();
    logger.silent(false);
  });

  it(
    "should fail to start because there isn't contract at given address",
    async function (): Promise<void> {
      await expect(eth1.start())
        .to.be.rejectedWith('There is no deposit contract at given address');
    }
  );

  it(
    "should start notifier before Eth2Genesis event",
    async function (): Promise<void> {
      const stubContract = sinon.createStubInstance(Contract);
      const stubProvider = sinon.createStubInstance(Provider);
      stubProvider.getLogs = sandbox.stub();
      stubProvider.getNetwork = sandbox.stub();
      stubProvider.on = sandbox.stub();
      // @ts-ignore
      stubContract.interface = {
        events: {
          Eth2Genesis: {
            //random hash
            topic: 'genesisHash'
          },
          Deposit: {
            //random hash
            topic: 'depositHash'
          }
        },
        parseLog: sandbox.stub()
      };
      const notifier = new EthersEth1Notifier({
        depositContract: defaults,
        // @ts-ignore
        provider: stubProvider,
        // @ts-ignore
        contract: stubContract
      },
      {
        opPool,
        logger: logger
      }
      );
      stubContract.on.returns(null);
      //@ts-ignore
      stubContract.interface.parseLog.returns({
        values: {
          pubkey: '0x' + Buffer.alloc(48, 0).toString('hex'),
          withdrawalCredentials: '0x' + Buffer.alloc(48, 0).toString('hex'),
          amount: '0x' + serialize(10, number64).toString('hex'),
          signature: '0x' + Buffer.alloc(96, 0).toString('hex'),
          merkleTreeIndex: '0x' + serialize(12, number64).toString('hex')
        }
      });
      stubProvider.getLogs.withArgs(sinon.match.hasNested('topics[0]', 'genesisHash')).resolves([]);
      stubProvider.getLogs.withArgs(sinon.match.hasNested('topics[0]', 'depositHash')).resolves([
        {} as any
      ]);
      stubProvider.getNetwork.resolves({
        chainId: 212,
        ensAddress:'',
        name: 'test'
      });
      await notifier.start();
      expect(stubProvider.on.withArgs('block', sinon.match.any).calledOnce).to.be.true;
      expect(stubContract.on.withArgs('Deposit', sinon.match.any).called).to.be.true;
      expect(stubContract.on.withArgs('Eth2Genesis', sinon.match.any).called).to.be.true;
      expect(opPool.receiveDeposit.calledOnce).to.be.true;
    }
  );

  it(
    "should start notifier after Eth2Genesis event",
    async function (): Promise<void> {
      const contract = sinon.createStubInstance(Contract);
      // @ts-ignore
      contract.interface = {
        events: {
          Eth2Genesis: {
            //random hash
            topic: '0x6be15e8568869b1e100750dd5079151b32637268ec08d199b318b793181b8a7d'
          }
        }
      };

      const stubProvider = sinon.createStubInstance(Provider);
      stubProvider.getLogs = sandbox.stub();
      stubProvider.on = sandbox.stub();
      stubProvider.getLogs.resolves([
        //Eth2Genesis event log
        {
        } as any
      ]);

      const notifier = new EthersEth1Notifier({
        depositContract: defaults,
        // @ts-ignore
        provider: stubProvider,
        // @ts-ignore
        contract
      },
      {
        opPool,
        logger: logger
      });

      contract.on.returns(null);
      await notifier.start();
      expect(stubProvider.on.withArgs('block', sinon.match.any).calledOnce).to.be.true;
      expect(contract.on.withArgs('Deposit', sinon.match.any).calledOnce).to.be.false;
      expect(contract.on.withArgs('Eth2Genesis', sinon.match.any).calledOnce).to.be.false;
    }
  );

  it(
    "should stop notifier",
    async function (): Promise<void> {
      const contract = sinon.createStubInstance(Contract);
      const notifier = new EthersEth1Notifier({
        depositContract: defaults,
        provider,
        // @ts-ignore
        contract
      },
      {
        opPool,
        logger: logger
      });
      contract.removeAllListeners.returns(null);
      await notifier.stop();
      expect(contract.removeAllListeners.withArgs('Deposit').calledOnce).to.be.true;
      expect(contract.removeAllListeners.withArgs('Eth2Genesis').calledOnce).to.be.true;
    }
  );

  it("should process a Deposit log", async function () {
    const cb = sinon.spy();
    eth1.on('deposit', cb);

    const pubKey = bls.generateKeyPair().publicKey.toBytesCompressed();
    const withdrawalCredentials = "0x" + Buffer.alloc(32).toString("hex");
    const amount = "0x" + serialize(32000000000, number64).toString("hex");
    const signature = "0x" + Buffer.alloc(94).toString("hex");
    const merkleTreeIndex = "0x" + serialize(0 , number64).toString("hex");
    opPool.receiveDeposit.resolves(null);
    await eth1.processDepositLog(pubKey, withdrawalCredentials, amount, signature, merkleTreeIndex);
    assert(cb.calledOnce, "deposit event did not fire");
  });

  it("should process a Eth2Genesis log", async function () {
    const cb = sinon.spy();
    eth1.on("eth2genesis", cb);

    const depositRootHex = "0x" + Buffer.alloc(32).toString("hex");
    const depositCountHex = "0x" + new BN(2).toBuffer('le', 6).toString('hex');
    const timeBuf = Buffer.alloc(8);
    const unixTimeNow = Math.floor(Date.now() / 1000);
    timeBuf.writeUInt32LE(unixTimeNow, 0);
    const timeHex = "0x" + timeBuf.toString("hex");
    const event = {blockHash: "0x0000000000000000"} as Event;
    const genesisDeposits = [
      generateDeposit(),
      generateDeposit(),
    ];
    opPool.getDeposits.resolves(genesisDeposits);
    await eth1.processEth2GenesisLog(depositRootHex, depositCountHex, timeHex, event);
    assert(
      cb.withArgs(sinon.match.any, genesisDeposits, sinon.match.any).calledOnce,
      "eth2genesis event did not fire"
    );
  });

  it("should process a new block", async function (): Promise<void> {
    this.timeout(0);

    const cb = sinon.spy();
    eth1.on("block", cb);

    await eth1.processBlockHeadUpdate(0);
    assert(cb.calledOnce, "new block event did not fire");
  });

  it("should get block 0", async function (): Promise<void> {
    const block = await eth1.getBlock(0);
    expect(block).to.not.be.null;
  });

  it("should get block by hash", async function (): Promise<void> {
    let block = await eth1.getBlock(0);
    block = await eth1.getBlock(block.hash);
    expect(block).to.not.be.null;
  });

  it("should get latest block", async function (): Promise<void> {
    let block = await eth1.getHead();
    expect(block).to.not.be.null;
  });

  it("should get deposit root from contract", async function (): Promise<void> {
    const spy = sinon.stub();
    // @ts-ignore
    const contract: Contract = {
      // eslint-disable-next-line
      get_deposit_root: spy
    };
    const notifier = new EthersEth1Notifier({
      depositContract: defaults,
      provider,
      contract
    },
    {
      opPool,
      logger: logger
    });
    const testDepositRoot = Buffer.alloc(32);
    spy.resolves('0x' + testDepositRoot.toString('hex'));

    const depositRoot = await notifier.depositRoot();
    expect(depositRoot).to.be.deep.equal(testDepositRoot);

  });

});
