import {describe, expect, it} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {sszTypesFor} from "@lodestar/types";
import {ReqRespMethod, responseSszTypeByMethod} from "../../../../src/network/reqresp/types.js";
import {collectMaxResponseTypedWithBytes} from "../../../../src/network/reqresp/utils/collect.js";
import {collectSequentialBlocksInRange} from "../../../../src/network/reqresp/utils/collectSequentialBlocksInRange.js";

describe.each([ForkName.phase0, ForkName.electra, ForkName.fulu, ForkName.gloas])("%s response bytes", (fork) => {
  it.each([ReqRespMethod.BeaconBlocksByRange, ReqRespMethod.BeaconBlocksByRoot])(
    "preserves %s block bytes containing non-byte-aligned aggregation bits",
    async (method) => {
      const types = sszTypesFor(fork);
      const block = types.SignedBeaconBlock.defaultValue();
      block.message.slot = 1;
      const attestation = types.Attestation.defaultValue();
      attestation.aggregationBits = BitArray.fromSingleBit(9, 8);
      block.message.body.attestations = [attestation];
      const bytes = types.SignedBeaconBlock.serialize(block);
      const originalBytes = Uint8Array.from(bytes);
      async function* source() {
        yield {data: bytes, fork, protocolVersion: 2};
      }

      const responses =
        method === ReqRespMethod.BeaconBlocksByRange
          ? await collectSequentialBlocksInRange(source(), {startSlot: 1, count: 1}, (block, bytes) => ({block, bytes}))
          : await collectMaxResponseTypedWithBytes(
              source(),
              1,
              responseSszTypeByMethod[ReqRespMethod.BeaconBlocksByRoot],
              (block, bytes) => ({block, bytes})
            );

      expect(responses).toHaveLength(1);
      expect(types.SignedBeaconBlock.equals(responses[0].block, block)).toBe(true);
      expect(responses[0].bytes).toBe(bytes);
      expect(bytes).toEqual(originalBytes);
      expect(types.SignedBeaconBlock.equals(types.SignedBeaconBlock.deserialize(bytes), block)).toBe(true);
    }
  );
});
