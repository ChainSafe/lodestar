import {itBench} from "@dapplion/benchmark";
import {BitArray} from "@chainsafe/ssz";
import {TARGET_AGGREGATORS_PER_COMMITTEE} from "@lodestar/params";
import {SeenAggregatedAttestations} from "../../../../src/chain/seenCache/seenAggregateAndProof.js";

describe("SeenAggregatedAttestations perf test", () => {
  const targetEpoch = 2022;
  const attDataRoot = "0x55e1a1cce2aeb66f85b2285b8cb7aa55dfb67148b5e0067f0692b61ddbd2824b";
  const fullByte = 0b11111111;
  // as of May 2022, there are ~24*8 attesters per committee (slot + index)
  const numAttestersInByte = 24;
  const seedBits = new Uint8Array(Array.from({length: numAttestersInByte}, () => fullByte));
  const toAggregationBitsSingleFalse = (i: number): BitArray => {
    const bits = new Uint8Array(seedBits.buffer);
    const aggregationBits = new BitArray(bits, numAttestersInByte * 8);
    aggregationBits.set(i, false);
    return aggregationBits;
  };

  const testCases: {id: string; aggregationBits: BitArray}[] = [
    {id: "isKnown best case - 1 super set check", aggregationBits: toAggregationBitsSingleFalse(0)},
    // as monitored in metric, there are 2 set check check in average
    {id: "isKnown normal case - 2 super set checks", aggregationBits: toAggregationBitsSingleFalse(1)},
    {
      id: "isKnown worse case - 16 super set checks",
      aggregationBits: toAggregationBitsSingleFalse(TARGET_AGGREGATORS_PER_COMMITTEE - 1),
    },
  ];

  for (const {id, aggregationBits} of testCases) {
    itBench({
      id,
      beforeEach: () => {
        const seenCache = new SeenAggregatedAttestations(null);
        // worse case scenario is we have TARGET_AGGREGATORS_PER_COMMITTEE (16) per attestation data
        for (let i = 0; i < TARGET_AGGREGATORS_PER_COMMITTEE; i++) {
          const aggregationInfo = {
            aggregationBits: toAggregationBitsSingleFalse(i),
            trueBitCount: numAttestersInByte * 8 - 1,
          };
          seenCache.add(targetEpoch, attDataRoot, aggregationInfo, false);
        }

        return seenCache;
      },
      fn: (seenCache) => {
        seenCache.isKnown(targetEpoch, attDataRoot, aggregationBits);
      },
    });
  }
});
