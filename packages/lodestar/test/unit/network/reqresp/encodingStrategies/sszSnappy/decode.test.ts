import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {encode} from "varint";
import {config} from "@chainsafe/lodestar-config/minimal";
import {BufferedSource} from "../../../../../../src/network/reqresp/utils/bufferedSource";
import {readSszSnappyChunk} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy/decode";
import {SszSnappyErrorCode} from "../../../../../../src/network/reqresp/encodingStrategies/sszSnappy/errors";
import {Method, Methods} from "../../../../../../src/constants";

chai.use(chaiAsPromised);

describe("sszSnappy decode - error", function () {
  const testCases: {
    id: string;
    method: Method;
    error: SszSnappyErrorCode;
    chunks: Buffer[];
  }[] = [
    {
      id: "if it takes more than 10 bytes for varint",
      method: Method.Status,
      error: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT,
      chunks: [Buffer.from(encode(99999999999999999999999))],
    },
    {
      id: "if failed ssz size bound validation",
      method: Method.Status,
      error: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE,
      chunks: [Buffer.alloc(12, 0)],
    },
    {
      id: "if it read more than maxEncodedLen",
      method: Method.Status,
      error: SszSnappyErrorCode.TOO_MUCH_BYTES_READ,
      chunks: [Buffer.from(encode(config.types.Status.minSize())), Buffer.alloc(config.types.Status.minSize() + 10)],
    },
    {
      id: "if failed ssz snappy input malformed",
      method: Method.Status,
      error: SszSnappyErrorCode.DECOMPRESSOR_ERROR,
      chunks: [Buffer.from(encode(config.types.Status.minSize())), Buffer.from("wrong snappy data")],
    },
  ];

  for (const {id, method, error, chunks} of testCases) {
    it(id, async () => {
      const type = Methods[method].requestSSZType(config);
      if (!type) throw Error("no type");

      async function* source(): AsyncGenerator<Buffer> {
        for (const chunk of chunks) {
          yield chunk;
        }
      }

      const bufferedSource = new BufferedSource(source());
      await expect(readSszSnappyChunk(bufferedSource, type)).to.be.rejectedWith(error);
    });
  }
});
