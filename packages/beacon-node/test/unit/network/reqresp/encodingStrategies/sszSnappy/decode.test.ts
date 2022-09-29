import {expect} from "chai";
import varint from "varint";
import {Uint8ArrayList} from "uint8arraylist";
import {ssz} from "@lodestar/types";
import {RequestOrResponseType} from "../../../../../../src/network/reqresp/types.js";
import {BufferedSource} from "../../../../../../src/network/reqresp/utils/index.js";
import {
  SszSnappyErrorCode,
  readSszSnappyPayload,
} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy/index.js";
import {isEqualSszType} from "../../../../../utils/ssz.js";
import {arrToSource} from "../../utils.js";
import {sszSnappyPing, sszSnappyStatus, sszSnappySignedBeaconBlockPhase0} from "./testData.js";

describe("network / reqresp / sszSnappy / decode", () => {
  describe("Test data vectors (generated in a previous version)", () => {
    const testCases = [sszSnappyPing, sszSnappyStatus, sszSnappySignedBeaconBlockPhase0];

    for (const {id, type, body, chunks} of testCases) {
      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource(chunks));
        const bodyResult = await readSszSnappyPayload(bufferedSource, type);
        expect(isEqualSszType(type, bodyResult, body)).to.equal(true, "Wrong decoded body");
      });
    }
  });

  describe("Error cases", () => {
    const testCases: {
      id: string;
      type: RequestOrResponseType;
      error: SszSnappyErrorCode;
      chunks: Buffer[];
    }[] = [
      {
        id: "if it takes more than 10 bytes for varint",
        type: ssz.phase0.Status,
        error: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT,
        // Used varint@5.0.2 to generated this hex payload because of https://github.com/chrisdickinson/varint/pull/20
        chunks: [Buffer.from("80808080808080808080808010", "hex")],
      },
      {
        id: "if failed ssz size bound validation",
        type: ssz.phase0.Status,
        error: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE,
        chunks: [Buffer.alloc(12, 0)],
      },
      {
        id: "if it read more than maxEncodedLen",
        type: ssz.phase0.Ping,
        error: SszSnappyErrorCode.TOO_MUCH_BYTES_READ,
        chunks: [Buffer.from(varint.encode(ssz.phase0.Ping.minSize)), Buffer.alloc(100)],
      },
      {
        id: "if failed ssz snappy input malformed",
        type: ssz.phase0.Status,
        error: SszSnappyErrorCode.DECOMPRESSOR_ERROR,
        chunks: [Buffer.from(varint.encode(ssz.phase0.Status.minSize)), Buffer.from("wrong snappy data")],
      },
    ];

    for (const {id, type, error, chunks} of testCases) {
      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource([new Uint8ArrayList(...chunks)]));
        await expect(readSszSnappyPayload(bufferedSource, type)).to.be.rejectedWith(error);
      });
    }
  });
});
