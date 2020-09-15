import "mocha";
import {expect} from "chai";
import {fromHexString} from "@chainsafe/ssz";
import {IEth1Block} from "../../../src/eth1/types";
import {fetchBlockRange} from "../../../src/eth1/httpEth1Client";
import {goerliRpcUrl} from "../../testParams";

describe("eth1 / httpEth1Client", function () {
  this.timeout("2 min");

  it("Should fetch a block range", async function () {
    const firstGoerliBlocks: IEth1Block[] = [
      [0, 1548854791, "0xbf7e331f7f7c1dd2e05159666b3bf8bc7a8a3a9eb1d518969eab529dd9b88c1a"],
      [1, 1548947453, "0x8f5bab218b6bb34476f51ca588e9f4553a3a7ce5e13a66c660a5283e97e9a85a"],
      [2, 1548947468, "0xe675f1362d82cdd1ec260b16fb046c17f61d8a84808150f5d715ccce775f575e"],
      [3, 1548947483, "0xd5daa825732729bb0d2fd187a1b888e6bfc890f1fc5333984740d9052afb2920"],
      [4, 1548947498, "0xfe43c87178f0f87c2be161389aa2d35f3065d330bb596a6d9e01529706bf040d"],
    ].map(([number, timestamp, hash]) => ({
      hash: fromHexString(hash as string),
      number: number as number,
      timestamp: timestamp as number,
    }));

    const blocks = await fetchBlockRange(
      goerliRpcUrl,
      firstGoerliBlocks[0].number,
      firstGoerliBlocks[firstGoerliBlocks.length - 1].number
    );

    expect(blocks).to.deep.equal(firstGoerliBlocks);
  });
});
