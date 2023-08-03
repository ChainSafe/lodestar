import {itBench} from "@dapplion/benchmark";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {AttestationData, IndexedAttestation} from "@lodestar/types/phase0";
import {ATTESTATION_SUBNET_COUNT} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {initializeForkChoice} from "./util.js";

describe("ForkChoice onAttestation", () => {
  /**
   * Committee:       | ----------- 0 --------------| ... | ----------------------- i --------------------- | ------------------------63 -------------------------|
   * Validator index: | 0 1 2 ... committeeLength-1 | ... | (i*committeeLengh + ) 0 1 2 ... committeeLengh-1| (63*committeeLengh +) 0 1 2 ... committeeLength - 1 |
   */
  itBench({
    id: "pass gossip attestations to forkchoice per slot",
    beforeEach: () => {
      const initialBlockCount = 64;
      const forkchoice = initializeForkChoice({
        initialBlockCount,
        initialValidatorCount: 600_000,
        initialEquivocatedCount: 0,
      });
      const head = forkchoice.updateHead();

      // at slot 64, forkchoice receives attestations of slot 63
      forkchoice.updateTime(initialBlockCount);
      // there are 700 aggregate and proof max per slot
      // as of Jan 2022
      const committeeLength = 135;
      // considering TARGET_AGGREGATORS_PER_COMMITTEE=16, it's not likely we have more than this number of aggregators
      // connect to node per slot
      const numAggregatorsConnectedToNode = 3;
      const attestationDataOmitIndex: Omit<AttestationData, "index"> = {
        beaconBlockRoot: fromHexString(head.blockRoot),
        slot: initialBlockCount - 1,
        source: {
          epoch: head.justifiedEpoch,
          root: fromHexString(head.justifiedRoot),
        },
        target: {
          epoch: computeEpochAtSlot(head.slot),
          root: fromHexString(head.targetRoot),
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

      return {forkchoice, allAttestationsPerSlot: [...unaggregatedAttestations, ...aggregatedAttestations]};
    },
    fn: ({forkchoice, allAttestationsPerSlot}) => {
      for (const attestation of allAttestationsPerSlot) {
        forkchoice.onAttestation(attestation, toHexString(ssz.phase0.AttestationData.hashTreeRoot(attestation.data)));
      }
    },
  });
});
