import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {fastSerializeEth1Data, pickEth1Vote} from "../../../src/eth1/utils/eth1Vote";
import {ContainerType, ListType} from "@chainsafe/ssz";

describe("eth1 / pickEth1Vote", () => {
  const ETH1_FOLLOW_DISTANCE_MAINNET = 2048;
  const EPOCHS_PER_ETH1_VOTING_PERIOD_MAINNET = 64;
  const SLOTS_PER_EPOCH_MAINNET = 32;
  const eth1DataVotesLimit = EPOCHS_PER_ETH1_VOTING_PERIOD_MAINNET * SLOTS_PER_EPOCH_MAINNET;

  const stateMainnetType = new ContainerType<phase0.BeaconState>({
    fields: {
      eth1DataVotes: new ListType({elementType: ssz.phase0.Eth1Data, limit: eth1DataVotesLimit}),
    },
  });

  const stateNoVotes = stateMainnetType.defaultTreeBacked();
  const stateMaxVotes = stateMainnetType.defaultTreeBacked();

  stateMaxVotes.eth1DataVotes = Array.from({length: eth1DataVotesLimit}, () =>
    ssz.phase0.Eth1Data.createTreeBackedFromStruct({
      depositRoot: Buffer.alloc(32, 0xdd),
      // All votes are the same
      depositCount: 1e6,
      blockHash: Buffer.alloc(32, 0xdd),
    })
  );

  // votesToConsider range:
  // lte: periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE,
  // gte: periodStart - SECONDS_PER_ETH1_BLOCK * ETH1_FOLLOW_DISTANCE * 2,
  const votesToConsider = Array.from({length: ETH1_FOLLOW_DISTANCE_MAINNET}, (_, i) => ({
    depositRoot: Buffer.alloc(32, 0xdd),
    // Each eth1Data is different
    depositCount: 1e6 + i,
    blockHash: Buffer.alloc(32, 0xdd),
  }));

  itBench("pickEth1Vote - no votes", () => {
    pickEth1Vote(stateNoVotes, votesToConsider);
  });

  itBench("pickEth1Vote - max votes", () => {
    pickEth1Vote(stateMaxVotes, votesToConsider);
  });
});

// Results in Linux Feb 2022
//
// eth1 / pickEth1Vote serializers
// ✓ pickEth1Vote - Eth1Data hashTreeRoot value x2048                    58.45559 ops/s    17.10700 ms/op        -         45 runs   1.27 s
// ✓ pickEth1Vote - Eth1Data hashTreeRoot tree x2048                     122.1150 ops/s    8.189003 ms/op        -         65 runs   1.75 s
// ✓ pickEth1Vote - Eth1Data fastSerialize value x2048                   533.9807 ops/s    1.872727 ms/op        -        272 runs   1.01 s
// ✓ pickEth1Vote - Eth1Data fastSerialize tree x2048                    59.49406 ops/s    16.80840 ms/op        -         60 runs   1.51 s

describe("eth1 / pickEth1Vote serializers", () => {
  setBenchOpts({noThreshold: true});

  const ETH1_FOLLOW_DISTANCE_MAINNET = 2048;
  const eth1DataValue: phase0.Eth1Data = {
    depositRoot: Buffer.alloc(32, 0xdd),
    depositCount: 1e6,
    blockHash: Buffer.alloc(32, 0xdd),
  };
  const eth1DataTree = ssz.phase0.Eth1Data.createTreeBackedFromStruct(eth1DataValue);

  itBench(`pickEth1Vote - Eth1Data hashTreeRoot value x${ETH1_FOLLOW_DISTANCE_MAINNET}`, () => {
    for (let i = 0; i < ETH1_FOLLOW_DISTANCE_MAINNET; i++) {
      ssz.phase0.Eth1Data.hashTreeRoot(eth1DataValue);
    }
  });

  // Create new copies of eth1DataTree to drop the hashing cache
  itBench({
    id: `pickEth1Vote - Eth1Data hashTreeRoot tree x${ETH1_FOLLOW_DISTANCE_MAINNET}`,
    beforeEach: () =>
      Array.from({length: ETH1_FOLLOW_DISTANCE_MAINNET}, () =>
        ssz.phase0.Eth1Data.createTreeBackedFromStruct(eth1DataValue)
      ),
    fn: (eth1DataTrees) => {
      for (let i = 0; i < eth1DataTrees.length; i++) {
        ssz.phase0.Eth1Data.hashTreeRoot(eth1DataTrees[i]);
      }
    },
  });

  itBench(`pickEth1Vote - Eth1Data fastSerialize value x${ETH1_FOLLOW_DISTANCE_MAINNET}`, () => {
    for (let i = 0; i < ETH1_FOLLOW_DISTANCE_MAINNET; i++) {
      fastSerializeEth1Data(eth1DataValue);
    }
  });

  itBench(`pickEth1Vote - Eth1Data fastSerialize tree x${ETH1_FOLLOW_DISTANCE_MAINNET}`, () => {
    for (let i = 0; i < ETH1_FOLLOW_DISTANCE_MAINNET; i++) {
      fastSerializeEth1Data(eth1DataTree);
    }
  });
});
