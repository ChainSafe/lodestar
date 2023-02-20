import {expect} from "chai";
import {config} from "@lodestar/config/default";
import {phase0, ssz} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {BeaconStateAllForks} from "@lodestar/state-transition";
import {generateState} from "../../../utils/state.js";
import {filterBy} from "../../../utils/db.js";
import {
  getEth1VotesToConsider,
  pickEth1Vote,
  votingPeriodStartTime,
  Eth1DataGetter,
} from "../../../../src/eth1/utils/eth1Vote.js";

describe("eth1 / util / eth1Vote", function () {
  function generateEth1Vote(i: number): phase0.Eth1Data {
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
      eth1DataVotesInState: phase0.Eth1Data[];
      votesToConsider: phase0.Eth1Data[];
      expectedEth1Vote: phase0.Eth1Data;
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
      it(id, async function () {
        const state = generateState({slot: 5, eth1DataVotes: eth1DataVotesInState});
        const eth1Vote = pickEth1Vote(state, votesToConsider);
        expect(ssz.phase0.Eth1Data.toJson(eth1Vote)).to.deep.equal(ssz.phase0.Eth1Data.toJson(expectedEth1Vote));
      });
    }
  });

  describe("getEth1VotesToConsider", function () {
    // Function array to scope votes in each test case defintion
    const testCases: (() => {
      id: string;
      state: BeaconStateAllForks;
      eth1Datas: Eth1DataWithTimestamp[];
      expectedVotesToConsider: phase0.Eth1Data[];
    })[] = [
      () => {
        const state = generateState({eth1Data: generateEth1Vote(0)});
        const timestampInRange = getTimestampInRange(config, state);
        const vote1 = getEth1DataBlock({depositCount: 1, timestamp: 0});
        const vote2 = getEth1DataBlock({depositCount: 1, timestamp: timestampInRange});
        const vote3 = getEth1DataBlock({depositCount: 1, timestamp: Infinity});
        return {
          id: "Only consider blocks with a timestamp in range",
          state,
          eth1Datas: [vote1, vote2, vote3].map(getEth1DataBlock),
          expectedVotesToConsider: [vote2],
        };
      },
      () => {
        const state = generateState({eth1Data: generateEth1Vote(11)});
        const timestampInRange = getTimestampInRange(config, state);
        const vote1 = getEth1DataBlock({depositCount: 10, timestamp: timestampInRange});
        const vote2 = getEth1DataBlock({depositCount: 12, timestamp: timestampInRange});
        return {
          id: "Ensure first vote is depositCount < current state is not considered",
          state,
          eth1Datas: [vote1, vote2].map(getEth1DataBlock),
          expectedVotesToConsider: [vote2],
        };
      },
    ];

    for (const testCase of testCases) {
      const {id, state, eth1Datas, expectedVotesToConsider} = testCase();
      it(`get votesToConsider: ${id}`, async function () {
        const eth1DataGetter: Eth1DataGetter = async ({timestampRange}) =>
          filterBy(eth1Datas, timestampRange, (eth1Data) => eth1Data.timestamp);

        const votesToConsider = await getEth1VotesToConsider(config, state, eth1DataGetter);

        expect(votesToConsider.map((eth1Data) => ssz.phase0.Eth1Data.toJson(eth1Data))).to.deep.equal(
          expectedVotesToConsider.map((eth1Data) => ssz.phase0.Eth1Data.toJson(eth1Data))
        );
      });
    }
  });
});

interface Eth1DataWithTimestamp extends phase0.Eth1Data {
  timestamp: number;
}

/**
 * Util: Fill partial eth1DataBlock with mock data
 * @param eth1DataBlock
 */
function getEth1DataBlock(eth1DataBlock: Partial<Eth1DataWithTimestamp>): Eth1DataWithTimestamp {
  return {
    blockHash: Buffer.alloc(32),
    depositRoot: Buffer.alloc(32),
    depositCount: 0,
    timestamp: 0,
    ...eth1DataBlock,
  };
}

/**
 * Util: Get a mock timestamp that passes isCandidateBlock validation
 * @param config
 * @param state
 */
function getTimestampInRange(config: ChainForkConfig, state: BeaconStateAllForks): number {
  const {SECONDS_PER_ETH1_BLOCK, ETH1_FOLLOW_DISTANCE} = config;
  const periodStart = votingPeriodStartTime(config, state);
  return periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE;
}
