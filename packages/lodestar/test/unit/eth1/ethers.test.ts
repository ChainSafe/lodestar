import chai, {assert, expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {Contract, ethers} from "ethers";
import ganache from "ganache-core";
import sinon from "sinon";
import {Provider} from "ethers/providers";
import promisify from "promisify-es6";
import bls from "@chainsafe/bls";
import {serialize} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {EthersEth1Notifier} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/options";
import {ILogger, WinstonLogger} from "../../../src/logger";
import {OpPool} from "../../../src/opPool";
import {DepositsOperations} from "../../../src/opPool/modules";


chai.use(chaiAsPromised);
describe("Eth1Notifier", () => {
  const ganacheProvider = ganache.provider();
  const provider = new ethers.providers.Web3Provider(ganacheProvider);
  let opPool;
  let eth1;
  let sandbox;
  let logger: ILogger = new WinstonLogger();

  before(async function (): Promise<void> {
    logger.silent = true;
    sandbox = sinon.createSandbox();
    opPool = sandbox.createStubInstance(OpPool);
    opPool.deposits = sandbox.createStubInstance(DepositsOperations);
    eth1 = new EthersEth1Notifier({
      ...defaults,
      providerInstance: provider
    },
    {
      config,
      logger: logger
    });
  });

  after(async () => {
    sandbox.restore();
    await promisify(ganacheProvider.close)();
    logger.silent = false;
  });

  it(
    "should fail to start because there isn't contract at given address",
    async function (): Promise<void> {
      await expect(eth1.start())
        .to.be.rejectedWith('There is no deposit contract at given address');
    }
  );

  it(
    "should start notifier",
    async function (): Promise<void> {
      const stubContract = sinon.createStubInstance(Contract);
      const stubProvider = sinon.createStubInstance(Provider);
      stubProvider.getLogs = sandbox.stub();
      stubProvider.getNetwork = sandbox.stub();
      stubProvider.on = sandbox.stub();
      // @ts-ignore
      stubContract.interface = {
        events: {
          Deposit: {
            //random hash
            topic: 'depositHash'
          }
        },
        parseLog: sandbox.stub()
      };
      const notifier = new EthersEth1Notifier({
        ...defaults,
        // @ts-ignore
        providerInstance: stubProvider,
        // @ts-ignore
        contract: stubContract
      },
      {
        config,
        logger: logger
      }
      );
      stubContract.on.returns(null);
      stubProvider.getNetwork.resolves({
        chainId: 212,
        ensAddress:'',
        name: 'test'
      });
      await notifier.start();
      expect(stubProvider.on.withArgs('block', sinon.match.any).calledOnce).to.be.true;
      expect(stubContract.on.withArgs('DepositEvent', sinon.match.any).called).to.be.true;
    }
  );

  it(
    "should stop notifier",
    async function (): Promise<void> {
      const contract = sinon.createStubInstance(Contract);
      const notifier = new EthersEth1Notifier({
        ...defaults,
        providerInstance: provider,
        // @ts-ignore
        contract
      },
      {
        opPool,
        logger: logger
      });
      contract.removeAllListeners.returns(null);
      await notifier.stop();
      expect(contract.removeAllListeners.withArgs('DepositEvent').calledOnce).to.be.true;
    }
  );

  it("should process a Deposit log", async function () {
    const cb = sinon.spy();
    eth1.on('deposit', cb);

    const pubKey = bls.generateKeyPair().publicKey.toBytesCompressed();
    const withdrawalCredentials = "0x" + Buffer.alloc(32).toString("hex");
    const amount = "0x" + serialize(32000000000, config.types.number64).toString("hex");
    const signature = "0x" + Buffer.alloc(94).toString("hex");
    const merkleTreeIndex = "0x" + serialize(0 , config.types.number64).toString("hex");
    await eth1.processDepositLog(pubKey, withdrawalCredentials, amount, signature, merkleTreeIndex);
    assert(cb.calledOnce, "deposit event did not fire");
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
      get_hash_tree_root: spy
    };
    const notifier = new EthersEth1Notifier({
      ...defaults,
      providerInstance: provider,
      contract
    },
    {
      config,
      logger: logger
    });
    const testDepositRoot = Buffer.alloc(32);
    spy.resolves('0x' + testDepositRoot.toString('hex'));

    const depositRoot = await notifier.depositRoot();
    expect(depositRoot).to.be.deep.equal(testDepositRoot);

  });

});
