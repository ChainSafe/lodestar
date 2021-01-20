import "mocha";
import {expect} from "chai";
import {Eth1Provider} from "../../../src/eth1";
import {IEth1Options} from "../../../src/eth1/options";
import {getTestnetConfig, testnet} from "../../utils/testnet";
import {fromHexString} from "@chainsafe/ssz";
import {Eth1Block} from "@chainsafe/lodestar-types";
import {goerliTestnetDepositEvents} from "../../utils/testnet";

describe("eth1 / Eth1Provider", function () {
  this.timeout("2 min");

  const eth1Options: IEth1Options = {
    enabled: true,
    providerUrl: testnet.providerUrl,
    depositContractDeployBlock: 0,
  };

  const config = getTestnetConfig();
  const eth1Provider = new Eth1Provider(config, eth1Options);

  it("Should validate contract", async function () {
    await eth1Provider.validateContract();
  });

  it("Should get latest block number", async function () {
    const blockNumber = await eth1Provider.getBlockNumber();
    expect(blockNumber).to.be.greaterThan(0);
  });

  it("Should get a specific block by number", async function () {
    const goerliGenesisBlock: Eth1Block = {
      blockHash: fromHexString("0xbf7e331f7f7c1dd2e05159666b3bf8bc7a8a3a9eb1d518969eab529dd9b88c1a"),
      blockNumber: 0,
      timestamp: 1548854791,
    };
    const block = await eth1Provider.getBlockByNumber(goerliGenesisBlock.blockNumber);
    expect(block).to.deep.equal(goerliGenesisBlock);
  });

  it("Should get deposits events for a block range", async function () {
    const blockNumbers = goerliTestnetDepositEvents.map((log) => log.blockNumber);
    const fromBlock = Math.min(...blockNumbers);
    const toBlock = Math.min(...blockNumbers);
    const depositEvents = await eth1Provider.getDepositEvents(fromBlock, toBlock);
    expect(depositEvents).to.deep.equal(goerliTestnetDepositEvents);
  });
});
