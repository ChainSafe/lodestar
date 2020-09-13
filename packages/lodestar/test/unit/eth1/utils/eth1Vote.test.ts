import {expect} from "chai";
import {generateState} from "../../../utils/state";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {List} from "@chainsafe/ssz";
import {Eth1Data} from "@chainsafe/lodestar-types";
import {pickEth1Vote} from "../../../../src/eth1/utils/eth1Vote";

describe("eth1 / util / eth1Vote", function () {
  function generateEth1Vote(i: number): Eth1Data {
    return {
      blockHash: Buffer.alloc(32, i),
      depositRoot: Buffer.alloc(32, i),
      depositCount: i,
    };
  }

  describe("pickEth1Vote", function () {
    // Function array to scope votes in each test case defintion
    const testCases: (() => {
      id: string;
      eth1DataVotesInState: Eth1Data[];
      votesToConsider: Eth1Data[];
      expectedEth1Vote: Eth1Data;
    })[] = [
      () => {
        const vote = generateEth1Vote(0);
        return {
          id: "basic case, pick the only valid vote",
          eth1DataVotesInState: [vote],
          votesToConsider: [vote],
          expectedEth1Vote: vote,
        };
      },
      () => {
        const vote = generateEth1Vote(0);
        const voteDefault = generateEth1Vote(1);
        return {
          id: "no valid votes in state, pick the default first from votesToConsider",
          eth1DataVotesInState: [vote],
          votesToConsider: [voteDefault],
          expectedEth1Vote: voteDefault,
        };
      },
      () => {
        const vote = generateEth1Vote(0);
        return {
          id: "no votes in state",
          eth1DataVotesInState: [],
          votesToConsider: [vote],
          expectedEth1Vote: vote,
        };
      },
      () => {
        const vote1 = generateEth1Vote(0);
        const vote2 = generateEth1Vote(1);
        const vote3 = generateEth1Vote(2);
        return {
          id: "pick most frequent vote",
          eth1DataVotesInState: [vote1, vote2, vote2, vote2, vote3],
          votesToConsider: [vote1, vote2, vote3],
          expectedEth1Vote: vote2,
        };
      },
      () => {
        const vote1 = generateEth1Vote(0);
        const vote2 = generateEth1Vote(0);
        return {
          id: "tiebreak",
          eth1DataVotesInState: [vote1, vote2],
          votesToConsider: [vote1, vote2],
          expectedEth1Vote: vote1,
        };
      },
    ];

    for (const testCase of testCases) {
      const {id, eth1DataVotesInState, votesToConsider, expectedEth1Vote} = testCase();
      it(`get eth1 vote: ${id}`, async function () {
        const state = generateState({slot: 5, eth1DataVotes: eth1DataVotesInState as List<Eth1Data>});
        const eth1Vote = pickEth1Vote(config, state, votesToConsider);
        expect(config.types.Eth1Data.equals(eth1Vote, expectedEth1Vote)).to.be.true;
      });
    }
  });
});
