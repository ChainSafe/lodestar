import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import varint from "varint";
import {ssz} from "@chainsafe/lodestar-types";
import {RequestOrResponseType} from "../../../../../../src/network/reqresp/types";
import {BufferedSource} from "../../../../../../src/network/reqresp/utils";
import {
  SszSnappyErrorCode,
  readSszSnappyPayload,
} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {isEqualSszType} from "../../../../../utils/ssz";
import {arrToSource} from "../../utils";
import {sszSnappyPing, sszSnappyStatus, sszSnappySignedBeaconBlockPhase0} from "./testData";

chai.use(chaiAsPromised);

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
        chunks: [Buffer.from(varint.encode(ssz.phase0.Ping.getMinSerializedLength())), Buffer.alloc(100)],
      },
      {
        id: "if failed ssz snappy input malformed",
        type: ssz.phase0.Status,
        error: SszSnappyErrorCode.DECOMPRESSOR_ERROR,
        chunks: [Buffer.from(varint.encode(ssz.phase0.Status.minSize())), Buffer.from("wrong snappy data")],
      },
    ];

    for (const {id, type, error, chunks} of testCases) {
      it(id, async () => {
        const bufferedSource = new BufferedSource(arrToSource(chunks));
        await expect(readSszSnappyPayload(bufferedSource, type)).to.be.rejectedWith(error);
      });
    }
  });
});
