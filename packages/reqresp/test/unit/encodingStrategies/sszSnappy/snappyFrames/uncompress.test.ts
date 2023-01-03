import {expect} from "chai";
import {Uint8ArrayList} from "uint8arraylist";
import snappy from "@chainsafe/snappy-stream";
import {SnappyFramesUncompress} from "../../../../../src/encodingStrategies/sszSnappy/snappyFrames/uncompress.js";

describe("encodingStrategies / sszSnappy / snappy frames / uncompress", function () {
  it("should work with short input", function (done) {
    const compressStream = snappy.createCompressStream();

    const decompress = new SnappyFramesUncompress();

    const testData = "Small test data";

    compressStream.on("data", function (data) {
      const result = decompress.uncompress(data);
      if (result) {
        expect(result.subarray().toString()).to.be.equal(testData);
        done();
      }
    });

    compressStream.write(testData);
  });

  it("should work with huge input", function (done) {
    const compressStream = snappy.createCompressStream();

    const decompress = new SnappyFramesUncompress();

    const testData = Buffer.alloc(100000, 4).toString();
    let result = Buffer.alloc(0);

    compressStream.on("data", function (data) {
      // testData will come compressed as two or more chunks
      result = Buffer.concat([result, decompress.uncompress(data)?.subarray() ?? Buffer.alloc(0)]);
      if (result.length === testData.length) {
        expect(result.toString()).to.be.equal(testData);
        done();
      }
    });

    compressStream.write(testData);
  });

  it("should detect malformed input", function () {
    const decompress = new SnappyFramesUncompress();

    expect(() => decompress.uncompress(new Uint8ArrayList(Buffer.alloc(32, 5)))).to.throw();
  });

  it("should return null if not enough data", function () {
    const decompress = new SnappyFramesUncompress();

    expect(decompress.uncompress(new Uint8ArrayList(Buffer.alloc(3, 1)))).to.equal(null);
  });
});
