import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import varint from "varint";
import {config} from "@chainsafe/lodestar-config/minimal";
import {RequestOrResponseType} from "../../../../../../src/network";
import {BufferedSource} from "../../../../../../src/network/reqresp/utils/bufferedSource";
import {
  SszSnappyErrorCode,
  readSszSnappyPayload,
} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy";
import {isEqualSszType} from "../../../../../utils/ssz";
import {arrToSource} from "../../utils";
import {sszSnappyPing, sszSnappyStatus, sszSnappySignedBlock} from "./testData";

chai.use(chaiAsPromised);

describe("network / reqresp / sszSnappy / decode", () => {
  describe("Test data vectors (generated in a previous version)", () => {
    const testCases = [sszSnappyPing, sszSnappyStatus, sszSnappySignedBlock];

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
        type: config.types.phase0.Status,
        error: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT,
        chunks: [Buffer.from(varint.encode(99999999999999999999999))],
      },
      {
        id: "if failed ssz size bound validation",
        type: config.types.phase0.Status,
        error: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE,
        chunks: [Buffer.alloc(12, 0)],
      },
      {
        id: "if it read more than maxEncodedLen",
        type: config.types.phase0.Ping,
        error: SszSnappyErrorCode.TOO_MUCH_BYTES_READ,
        chunks: [Buffer.from(varint.encode(config.types.phase0.Ping.getMinSerializedLength())), Buffer.alloc(100)],
      },
      {
        id: "if failed ssz snappy input malformed",
        type: config.types.phase0.Status,
        error: SszSnappyErrorCode.DECOMPRESSOR_ERROR,
        chunks: [Buffer.from(varint.encode(config.types.phase0.Status.minSize())), Buffer.from("wrong snappy data")],
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
