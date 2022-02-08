import {config} from "@chainsafe/lodestar-config/default";
import {itBench} from "@dapplion/benchmark";
import {AttestationData, IndexedAttestation} from "@chainsafe/lodestar-types/phase0";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {getEffectiveBalanceIncrementsZeroed} from "@chainsafe/lodestar-beacon-state-transition";
import {ssz} from "@chainsafe/lodestar-types";
import {fromHexString} from "@chainsafe/ssz";
import {ExecutionStatus, ForkChoice, IForkChoiceStore, IProtoBlock, ProtoArray} from "../../../src";

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
    protoArr = ProtoArray.initialize({
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
    } as Omit<IProtoBlock, "targetRoot">);

    const fcStore: IForkChoiceStore = {
      currentSlot: genesisSlot,
      justifiedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      finalizedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
      bestJustifiedCheckpoint: {epoch: genesisEpoch, root: fromHexString(finalizedRoot), rootHex: finalizedRoot},
    };

    forkchoice = new ForkChoice(config, fcStore, protoArr, getEffectiveBalanceIncrementsZeroed(0), false);

    let parentBlockRoot = finalizedRoot;
    // assume there are 64 unfinalized blocks, this number does not make a difference in term of performance
    for (let i = 1; i < 64; i++) {
      const blockRoot = i < 10 ? blockRootPrefix + "0" + i : blockRootPrefix + i;
      const block: IProtoBlock = {
        slot: genesisSlot + i,
        blockRoot,
        parentRoot: parentBlockRoot,
        stateRoot: i < 10 ? stateRootPrefix + "0" + i : stateRootPrefix + i,
        targetRoot: i < 32 ? genesisRoot : blockRootPrefix + "32",

        justifiedEpoch: i < 32 ? genesisEpoch : genesisEpoch + 1,
        justifiedRoot: i < 32 ? genesisRoot : blockRootPrefix + "32",
        finalizedEpoch: genesisEpoch,
        finalizedRoot: genesisRoot,

        executionPayloadBlockHash: null,
        executionStatus: ExecutionStatus.PreMerge,
      };

      protoArr.onBlock(block);
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
        const tbAttestationData = ssz.phase0.AttestationData.createTreeBackedFromStruct({
          ...attestationDataOmitIndex,
          index: committeeIndex,
        });
        // cache the root
        tbAttestationData.hashTreeRoot();
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
