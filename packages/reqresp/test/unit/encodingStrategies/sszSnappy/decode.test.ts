import {byteStream} from "@libp2p/utils";
import {encode as varintEncode} from "uint8-varint";
import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {SszSnappyErrorCode} from "../../../../src/encodingStrategies/sszSnappy/errors.js";
import {readSszSnappyPayload} from "../../../../src/encodingStrategies/sszSnappy/index.js";
import {ChunkType, IDENTIFIER_FRAME, crc} from "../../../../src/utils/snappyIndex.js";
import {
  encodingStrategiesDecodingErrorCases,
  encodingStrategiesMainnetTestCases,
  encodingStrategiesTestCases,
} from "../../../fixtures/index.js";
import {arrToSource} from "../../../utils/index.js";
import {createMockStream} from "../../../utils/mockStream.js";

describe("encodingStrategies / sszSnappy / decode", () => {
  for (const {name, raw} of [
    {name: "one-byte extended literal length", raw: "081841414141414141f00041"},
    {name: "two-byte literal with extended length", raw: "0814414141414141f0014141"},
    {name: "two-byte extended literal length", raw: "081841414141414141f4000041"},
  ]) {
    it.each([1, 7, 18])(`accepts Ping with ${name} in %i-byte chunks`, async (chunkSize) => {
      const ping = 0x4141414141414141n;
      const expected = ssz.phase0.Ping.serialize(ping);
      const frame = Buffer.concat([crc(expected), Buffer.from(raw, "hex")]);
      const wire = Buffer.concat([
        Buffer.from(varintEncode(expected.length)),
        IDENTIFIER_FRAME,
        Buffer.from([ChunkType.COMPRESSED, frame.length, 0, 0]),
        frame,
      ]);
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < wire.length; offset += chunkSize) {
        chunks.push(wire.subarray(offset, offset + chunkSize));
      }
      const {stream} = await createMockStream({source: arrToSource(chunks)});
      const bytes = byteStream(stream);
      const bodyResult = await readSszSnappyPayload(bytes, ssz.phase0.Ping).finally(() => bytes.unwrap());
      expect(bodyResult).toEqual(expected);
      expect(ssz.phase0.Ping.deserialize(bodyResult)).toBe(ping);
    });
  }

  it.each([1, 7, 18])("rejects incomplete compressed Ping data in %i-byte chunks", async (chunkSize) => {
    const wire = Buffer.concat([
      Buffer.from(varintEncode(ssz.phase0.Ping.minSize)),
      IDENTIFIER_FRAME,
      Buffer.from([ChunkType.COMPRESSED, 5, 0, 0]),
      crc(Buffer.alloc(ssz.phase0.Ping.minSize)),
      Buffer.from([ssz.phase0.Ping.minSize]),
    ]);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < wire.length; offset += chunkSize) {
      chunks.push(wire.subarray(offset, offset + chunkSize));
    }
    const {stream} = await createMockStream({source: arrToSource(chunks)});
    const bytes = byteStream(stream);
    await expect(readSszSnappyPayload(bytes, ssz.phase0.Ping).finally(() => bytes.unwrap())).rejects.toMatchObject({
      type: {code: SszSnappyErrorCode.DECOMPRESSOR_ERROR},
    });
  });

  it.each(encodingStrategiesTestCases)("$id", async ({type, binaryPayload, chunks}) => {
    const {stream} = await createMockStream({source: arrToSource(chunks)});
    const bytes = byteStream(stream);
    const bodyResult = await readSszSnappyPayload(bytes, type).finally(() => bytes.unwrap());
    expect(bodyResult).toEqual(binaryPayload.data);
  });

  describe("mainnet cases", () => {
    for (const {id, payload, type: serializer, streamedBody} of encodingStrategiesMainnetTestCases) {
      const bodySize = payload.data.length;
      const streamedBytes = new Uint8ArrayList(Buffer.concat([Buffer.from(varintEncode(bodySize)), streamedBody]));

      it(id, async () => {
        const {stream} = await createMockStream({source: arrToSource([streamedBytes])});
        const bytes = byteStream(stream);
        const bodyResult = await readSszSnappyPayload(bytes, serializer).finally(() => bytes.unwrap());

        expect(bodyResult).toEqual(new Uint8Array(payload.data));
      });
    }
  });

  describe("error cases", () => {
    for (const {id, type, error, chunks} of encodingStrategiesDecodingErrorCases) {
      it(id, async () => {
        const {stream} = await createMockStream({source: arrToSource([new Uint8ArrayList(...chunks)])});
        const bytes = byteStream(stream);
        await expect(readSszSnappyPayload(bytes, type)).rejects.toThrow(error);
        bytes.unwrap();
      });
    }
  });
});
