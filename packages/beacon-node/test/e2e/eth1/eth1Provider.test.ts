import "mocha";
import {expect} from "chai";
import {fromHexString} from "@chainsafe/ssz";
import {Eth1Options} from "../../../src/eth1/options.js";
import {getTestnetConfig} from "../../utils/testnet.js";
import {goerliTestnetDepositEvents} from "../../utils/testnet.js";
import {Eth1Provider, parseEth1Block} from "../../../src/eth1/provider/eth1Provider.js";
import {Eth1Block} from "../../../src/eth1/interface.js";
import {getGoerliRpcUrl} from "../../testParams.js";

describe.skip("eth1 / Eth1Provider", function () {
  this.timeout("2 min");

  let controller: AbortController;
  beforeEach(() => (controller = new AbortController()));
  afterEach(() => controller.abort());

  const config = getTestnetConfig();

  // Compute lazily since getGoerliRpcUrl() throws if GOERLI_RPC_URL is not set
  function getEth1Provider(): Eth1Provider {
    const eth1Options: Eth1Options = {
      enabled: true,
      providerUrls: [getGoerliRpcUrl()],
      depositContractDeployBlock: 0,
      unsafeAllowDepositDataOverwrite: false,
    };
    return new Eth1Provider(config, eth1Options, controller.signal);
  }

  it("Should validate contract", async function () {
    await getEth1Provider().validateContract();
  });

  it("Should get latest block number", async function () {
    const blockNumber = await getEth1Provider().getBlockNumber();
    expect(blockNumber).to.be.greaterThan(0);
  });

  it("Should get a specific block by number", async function () {
    const goerliGenesisBlock: Eth1Block = {
      blockHash: fromHexString("0xbf7e331f7f7c1dd2e05159666b3bf8bc7a8a3a9eb1d518969eab529dd9b88c1a"),
      blockNumber: 0,
      timestamp: 1548854791,
    };
    const block = await getEth1Provider().getBlockByNumber(goerliGenesisBlock.blockNumber);
    expect(block && parseEth1Block(block)).to.deep.equal(goerliGenesisBlock);
  });

  it("Should get deposits events for a block range", async function () {
    const blockNumbers = goerliTestnetDepositEvents.map((log) => log.blockNumber);
    const fromBlock = Math.min(...blockNumbers);
    const toBlock = Math.min(...blockNumbers);
    const depositEvents = await getEth1Provider().getDepositEvents(fromBlock, toBlock);
    expect(depositEvents).to.deep.equal(goerliTestnetDepositEvents);
  });

  //

  const firstGoerliBlocks: Eth1Block[] = [
    [0, 1548854791, "0xbf7e331f7f7c1dd2e05159666b3bf8bc7a8a3a9eb1d518969eab529dd9b88c1a"],
    [1, 1548947453, "0x8f5bab218b6bb34476f51ca588e9f4553a3a7ce5e13a66c660a5283e97e9a85a"],
    [2, 1548947468, "0xe675f1362d82cdd1ec260b16fb046c17f61d8a84808150f5d715ccce775f575e"],
    [3, 1548947483, "0xd5daa825732729bb0d2fd187a1b888e6bfc890f1fc5333984740d9052afb2920"],
    [4, 1548947498, "0xfe43c87178f0f87c2be161389aa2d35f3065d330bb596a6d9e01529706bf040d"],
  ].map(([number, timestamp, hash]) => ({
    blockHash: fromHexString(hash as string),
    blockNumber: number as number,
    timestamp: timestamp as number,
  }));

  const goerliSampleContract = {
    address: "0x07b39F4fDE4A38bACe212b546dAc87C58DfE3fDC",
    code: "0x60806040526004361061003f5760003560e01c806301ffc9a71461004457806322895118146100a",
  };

  it("getBlocksByNumber: Should fetch a block range", async function () {
    const fromBlock = firstGoerliBlocks[0].blockNumber;
    const toBlock = firstGoerliBlocks[firstGoerliBlocks.length - 1].blockNumber;
    const blocks = await getEth1Provider().getBlocksByNumber(fromBlock, toBlock);
    expect(blocks.map(parseEth1Block)).to.deep.equal(firstGoerliBlocks);
  });

  it("getBlockByNumber: Should fetch a single block", async function () {
    const firstGoerliBlock = firstGoerliBlocks[0];
    const block = await getEth1Provider().getBlockByNumber(firstGoerliBlock.blockNumber);
    expect(block && parseEth1Block(block)).to.deep.equal(firstGoerliBlock);
  });

  it("getBlockNumber: Should fetch latest block number", async function () {
    const blockNumber = await getEth1Provider().getBlockNumber();
    expect(blockNumber).to.be.a("number");
    expect(blockNumber).to.be.greaterThan(0);
  });

  it("getCode: Should fetch code for a contract", async function () {
    const code = await getEth1Provider().getCode(goerliSampleContract.address);
    expect(code).to.include(goerliSampleContract.code);
  });
});
