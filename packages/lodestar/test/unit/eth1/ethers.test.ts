import chai, {assert, expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {Contract, ethers} from "ethers";
import ganache from "ganache-core";
import sinon from "sinon";
import {BaseProvider, Block, Provider} from "ethers/providers";
import promisify from "promisify-es6";
import bls from "@chainsafe/bls";
import {serialize} from "@chainsafe/ssz";

import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import {EthersEth1Notifier} from "../../../src/eth1";
import defaults from "../../../src/eth1/dev/options";
import {ILogger, WinstonLogger} from "../../../src/logger";
import {OpPool} from "../../../src/opPool";
import {DepositsOperations} from "../../../src/opPool/modules";
import {describe, it} from "mocha";
import {generateEth1Data} from "../../utils/eth1Data";
import {ZERO_HASH} from "../../../src/constants";
import {filterValidVotes} from "../../../lib/chain/factory/block/eth1Data";
import {generateState} from "../../utils/state";
import {Eth1Data} from "@chainsafe/eth2.0-types";


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

  //TODO: fix those tests

  // describe("et1h votes filter", function () {
  //
  //   let eth1Notifier, providerStub;
  //
  //   beforeEach(function () {
  //     providerStub = sinon.createStubInstance(BaseProvider);
  //     eth1Notifier = new EthersEth1Notifier({
  //       ...defaults,
  //       providerInstance: providerStub
  //     },
  //     {
  //       config,
  //       logger: logger
  //     });
  //   });
  //
  //   it('should filter non cannonical vote', async function () {
  //     eth1Stub.getBlock.returns(null);
  //     const votes = [generateEth1Data()];
  //     const valid = await filterValidVotes(config, votes, eth1Stub, null, null);
  //     expect(valid.length).to.be.equal(0);
  //   });
  //
  //   it('should filter too young vote', async function () {
  //     eth1.provider =
  //         eth1Stub.getBlock.returns({number: 0});
  //     const votes = [generateEth1Data(ZERO_HASH)];
  //     const valid = await filterValidVotes(config, votes, eth1Stub, {number: config.params.ETH1_FOLLOW_DISTANCE - 1} as Block, null);
  //     expect(valid.length).to.be.equal(0);
  //   });
  //
  //   it('should filter vote older than state', async function () {
  //     eth1Stub.getBlock.returns({number: 0});
  //     const votes = [generateEth1Data(ZERO_HASH)];
  //     const valid = await filterValidVotes(config, votes, eth1Stub, {number: config.params.ETH1_FOLLOW_DISTANCE} as Block, {number: 1} as Block);
  //     expect(valid.length).to.be.equal(0);
  //   });
  //
  //   it('should filter vote because malformed deposit count', async function () {
  //     eth1Stub.getBlock.returns({number: 2});
  //     eth1Stub.depositCount.returns(1);
  //     eth1Stub.depositRoot.returns(ZERO_HASH);
  //     const votes = [generateEth1Data(ZERO_HASH)];
  //     const valid = await filterValidVotes(config, votes, eth1Stub, {number: config.params.ETH1_FOLLOW_DISTANCE + 2} as Block, {number: 1} as Block);
  //     expect(valid.length).to.be.equal(0);
  //     expect(eth1Stub.depositCount.calledOnce).to.be.true;
  //     expect(eth1Stub.depositRoot.calledOnce).to.be.true;
  //   });
  //
  //   it('should filter vote because malformed deposit root', async function () {
  //     eth1Stub.getBlock.returns({number: 2});
  //     eth1Stub.depositCount.returns(0);
  //     eth1Stub.depositRoot.returns(Buffer.alloc(32, 1));
  //     const votes = [generateEth1Data(ZERO_HASH)];
  //     const valid = await filterValidVotes(config, votes, eth1Stub, {number: config.params.ETH1_FOLLOW_DISTANCE + 2} as Block, {number: 1} as Block);
  //     expect(valid.length).to.be.equal(0);
  //     expect(eth1Stub.depositCount.calledOnce).to.be.true;
  //     expect(eth1Stub.depositRoot.calledOnce).to.be.true;
  //   });
  //
  //   it('should not filter valid vote', async function () {
  //     eth1Stub.getBlock.returns({number: 2});
  //     eth1Stub.depositCount.returns(0);
  //     eth1Stub.depositRoot.returns(ZERO_HASH);
  //     const votes = [generateEth1Data(ZERO_HASH)];
  //     const valid = await filterValidVotes(config, votes, eth1Stub, {number: config.params.ETH1_FOLLOW_DISTANCE + 2} as Block, {number: 1} as Block);
  //     expect(valid.length).to.be.equal(1);
  //     expect(eth1Stub.depositCount.calledOnce).to.be.true;
  //     expect(eth1Stub.depositRoot.calledOnce).to.be.true;
  //   });
  //
  // });

  // describe('best vote', function () {
  //
  //   it('no valid votes', async function () {
  //     eth1Stub.getBlock.returns({number: 0});
  //     const hash = Buffer.alloc(32, 4).toString('hex');
  //     eth1Stub.getBlock.withArgs(1).returns({
  //       hash
  //     });
  //     eth1Stub.depositRoot.withArgs(hash).returns(Buffer.alloc(32, 1));
  //     eth1Stub.depositCount.withArgs(hash).returns(2);
  //     eth1Stub.getHead.returns({number: config.params.ETH1_FOLLOW_DISTANCE + 1});
  //     const bestVote = await bestVoteData(config, generateState({eth1DataVotes: [generateEth1Data()]}), eth1Stub);
  //     expect(bestVote.blockHash).to.be.deep.equal(Buffer.from(hash.slice(2), 'hex'));
  //     expect(bestVote.depositCount).to.be.deep.equal(2);
  //     expect(bestVote.depositRoot).to.be.deep.equal(Buffer.alloc(32, 1));
  //   });
  //
  //   it('single most frequent valid vote', async function () {
  //     eth1Stub.getHead.returns({number: config.params.ETH1_FOLLOW_DISTANCE + 2});
  //     //latest eth block
  //     eth1Stub.getBlock.withArgs('0x' + Buffer.alloc(32, 9).toString('hex')).returns({number: 1});
  //     eth1Stub.getBlock.returns({number: 2});
  //     eth1Stub.depositCount.returns(0);
  //     eth1Stub.depositRoot.returns(ZERO_HASH);
  //
  //     const votes = [
  //       generateEth1Data(ZERO_HASH),
  //       generateEth1Data(ZERO_HASH),
  //       generateEth1Data(Buffer.alloc(32, 1))
  //     ];
  //     const bestVote = await bestVoteData(
  //         config,
  //         generateState({
  //           eth1DataVotes: votes,
  //           eth1Data: {blockHash: Buffer.alloc(32, 9)} as Eth1Data}
  //         ),
  //         eth1Stub
  //     );
  //     expect(bestVote).to.be.deep.equal(generateEth1Data(ZERO_HASH));
  //   });
  //
  //   it('multiple tied most frequent valid vote', async function () {
  //     eth1Stub.getHead.returns({number: config.params.ETH1_FOLLOW_DISTANCE + 2});
  //     //latest eth block
  //     eth1Stub.getBlock.withArgs('0x' + Buffer.alloc(32, 9).toString('hex')).resolves({number: 1});
  //     eth1Stub.getBlock.resolves({number: 2});
  //     eth1Stub.depositCount.returns(0);
  //     eth1Stub.depositRoot.returns(ZERO_HASH);
  //
  //     const votes = [
  //       generateEth1Data(ZERO_HASH),
  //       generateEth1Data(ZERO_HASH),
  //       generateEth1Data(Buffer.alloc(32, 1)),
  //       generateEth1Data(Buffer.alloc(32, 1))
  //     ];
  //     const bestVote = await bestVoteData(
  //         config,
  //         generateState({
  //           eth1DataVotes: votes,
  //           eth1Data: {blockHash: Buffer.alloc(32, 9)} as Eth1Data}
  //         ),
  //         eth1Stub
  //     );
  //     expect(bestVote).to.be.deep.equal(generateEth1Data(ZERO_HASH));
  //   });
  //
  // });
});
