import "mocha";
import {expect} from "chai";
import {Eth1Provider, IEth1Block} from "../../../src/eth1";
import {IEth1Options} from "../../../src/eth1/options";
import {getMedallaConfig, medalla} from "./util";

describe("eth1 / Eth1Provider", function () {
  this.timeout("2 min");

  const eth1Options: IEth1Options = {
    enabled: true,
    providerUrl: medalla.providerUrl,
    depositContractDeployBlock: 0,
  };

  function getEth1Provider(): Eth1Provider {
    return new Eth1Provider(getMedallaConfig(), eth1Options);
  }

  it("Should validate contract", async function () {
    await getEth1Provider().validateContract();
  });

  it("Should get latest block number", async function () {
    const blockNumber = await getEth1Provider().getBlockNumber();
    expect(blockNumber).to.be.greaterThan(0);
  });

  it("Should get a specific block by number", async function () {
    const goerliGenesisBlock: IEth1Block = {
      hash: "0xbf7e331f7f7c1dd2e05159666b3bf8bc7a8a3a9eb1d518969eab529dd9b88c1a",
      number: 0,
      timestamp: 1548854791,
    };
    const block = await getEth1Provider().getBlock(goerliGenesisBlock.number);
    expect(block).to.deep.equal(goerliGenesisBlock);
  });

  it("Should get deposits events for a block range", async function () {
    const goerliMedallaDeposit = {
      block: 3124930,
      depositIndexes: [6833],
    };
    const logs = await getEth1Provider().getDepositEvents(goerliMedallaDeposit.block, goerliMedallaDeposit.block);
    expect(logs.map((log) => log.index)).to.deep.equal(goerliMedallaDeposit.depositIndexes);
  });
});
