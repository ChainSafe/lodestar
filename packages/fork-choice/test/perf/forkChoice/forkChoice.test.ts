import {itBench} from "@dapplion/benchmark";
import {config} from "@lodestar/config/default";
import {AttestationData, IndexedAttestation} from "@lodestar/types/phase0";
import {ATTESTATION_SUBNET_COUNT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHexString} from "@chainsafe/ssz";
import {ExecutionStatus, ForkChoice, IForkChoiceStore, ProtoBlock, ProtoArray} from "../../../src/index.js";

describe("ForkChoice", () => {
  let forkchoice: ForkChoice;
  let protoArr: ProtoArray;

  const genesisSlot = 0;
  const genesisEpoch = 0;
  const genesisRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";

  const parentRoot = "0x853d08094d83f1db67159144db54ec0c882eb9715184c4bde8f4191c926a1671";
  const blockRootPrefix = "0x37487efdbfbeeb82d7d35c6eb96438c4576f645b0f4c0386184592abab4b17";
  const finalizedRoot = blockRootPrefix + "00";
  const stateRootPrefix = "0xb021a96da54dd89dfafc0e8817e23fe708f5746e924855f49b3f978133c3ac";
  const genesisStateRoot = stateRootPrefix + "00";

  function initializeForkChoice(): void {
    protoArr = ProtoArray.initialize(
      {
        slot: genesisSlot,
        stateRoot: genesisStateRoot,
        parentRoot,
        blockRoot: finalizedRoot,

        justifiedEpoch: genesisEpoch,
        justifiedRoot: genesisRoot,
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,

        executionPayloadBlockHash: null,
        executionStatus: ExecutionStatus.PreMerge,
      } as Omit<ProtoBlock, "targetRoot">,
      genesisSlot
    );
    // assume there are 64 unfinalized blocks, this number does not make a difference in term of performance
    const numBlocks = 64;
    const balances = new Uint8Array(Array.from({length: numBlocks}, () => 32));
    const fcStore: IForkChoiceStore = {
      currentSlot: genesisSlot,
      justified: {
        checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
        balances,
      },
      bestJustified: {
        checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
        balances,
      },
      unrealizedJustified: {
        checkpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
        balances,
      },
      finalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      unrealizedFinalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      justifiedBalancesGetter: () => balances,
      equivocatingIndices: new Set(),
    };

    forkchoice = new ForkChoice(config, fcStore, protoArr);

    let parentBlockRoot = finalizedRoot;
    for (let i = 1; i < numBlocks; i++) {
      const blockRoot = i < 10 ? blockRootPrefix + "0" + i : blockRootPrefix + i;
      const block: ProtoBlock = {
        slot: genesisSlot + i,
        blockRoot,
        parentRoot: parentBlockRoot,
        stateRoot: i < 10 ? stateRootPrefix + "0" + i : stateRootPrefix + i,
        targetRoot: i < 32 ? genesisRoot : blockRootPrefix + "32",

        justifiedEpoch: i < 32 ? genesisEpoch : genesisEpoch + 1,
        justifiedRoot: i < 32 ? genesisRoot : blockRootPrefix + "32",
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,
        unrealizedJustifiedEpoch: i < 32 ? genesisEpoch : genesisEpoch + 1,
        unrealizedJustifiedRoot: i < 32 ? genesisRoot : blockRootPrefix + "32",
        unrealizedFinalizedEpoch: genesisEpoch,
        unrealizedFinalizedRoot: genesisRoot,

        executionPayloadBlockHash: null,
        executionStatus: ExecutionStatus.PreMerge,
      };

      protoArr.onBlock(block, block.slot);
      parentBlockRoot = blockRoot;
    }
  }

  /**
   * Committee:       | ----------- 0 --------------| ... | ----------------------- i --------------------- | ------------------------63 -------------------------|
   * Validator index: | 0 1 2 ... committeeLength-1 | ... | (i*committeeLengh + ) 0 1 2 ... committeeLengh-1| (63*committeeLengh +) 0 1 2 ... committeeLength - 1 |
   */
  itBench({
    id: "pass gossip attestations to forkchoice per slot",
    beforeEach: () => {
      initializeForkChoice();
      // at slot 64, forkchoice receives attestations of slot 63
      forkchoice.updateTime(64);
      // there are 700 aggregate and proof max per slot
      // as of Jan 2022
      const committeeLength = 135;
      // considering TARGET_AGGREGATORS_PER_COMMITTEE=16, it's not likely we have more than this number of aggregators
      // connect to node per slot
      const numAggregatorsConnectedToNode = 3;
      const attestationDataOmitIndex: Omit<AttestationData, "index"> = {
        beaconBlockRoot: fromHexString(blockRootPrefix + "63"),
        slot: 63,
        source: {
          epoch: genesisEpoch,
          root: fromHexString(finalizedRoot),
        },
        target: {
          epoch: genesisEpoch + 1,
          root: fromHexString(blockRootPrefix + "32"),
        },
      };

      // unaggregatedAttestations: aggregator {i} for committee index {i}
      const unaggregatedAttestations: IndexedAttestation[] = [];
      for (let committeeIndex = 0; committeeIndex < numAggregatorsConnectedToNode; committeeIndex++) {
        const attestationData: AttestationData = {
          ...attestationDataOmitIndex,
          index: committeeIndex,
        };
        for (let i = 0; i < committeeLength; i++) {
          const validatorIndex = committeeIndex * committeeLength + i;
          unaggregatedAttestations.push({
            attestingIndices: [validatorIndex],
            data: attestationData,
            signature: Buffer.alloc(96),
          });
        }
      }

      // aggregated attestations: each committee index has 11 aggregators in average
      // 64 committee indices map to 704 aggregated attestations per slot
      const aggregatedAttestations: IndexedAttestation[] = [];
      const averageAggregatorsPerSlot = 11;
      for (let committeeIndex = 0; committeeIndex < ATTESTATION_SUBNET_COUNT; committeeIndex++) {
        const tbAttestationData = {
          ...attestationDataOmitIndex,
          index: committeeIndex,
        };

        // cache the root
        ssz.phase0.AttestationData.hashTreeRoot(tbAttestationData);

        for (let aggregator = 0; aggregator < averageAggregatorsPerSlot; aggregator++) {
          // same data, different signatures
          aggregatedAttestations.push({
            attestingIndices: Array.from({length: committeeLength}, (_, i) => committeeIndex * committeeLength + i),
            data: tbAttestationData,
            signature: Buffer.alloc(96, aggregator),
          });
        }
      }

      return [...unaggregatedAttestations, ...aggregatedAttestations];
    },
    fn: (allAttestationsPerSlot) => {
      for (const attestation of allAttestationsPerSlot) {
        forkchoice.onAttestation(attestation);
      }
    },
  });
});
