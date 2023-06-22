import {expect} from "chai";
import {Uint8ArrayList} from "uint8arraylist";
import {pipe} from "it-pipe";
import {SnappyFramesUncompress} from "../../../../../src/encodingStrategies/sszSnappy/snappyFrames/uncompress.js";
import {encodeSnappy} from "../../../../../src/encodingStrategies/sszSnappy/snappyFrames/compress.js";

describe("encodingStrategies / sszSnappy / snappy frames / uncompress", function () {
  it("should work with short input", function (done) {
    const testData = "Small test data";
    const compressIterable = encodeSnappy(Buffer.from(testData));

    const decompress = new SnappyFramesUncompress();

    void pipe(compressIterable, async function (source) {
      for await (const data of source) {
        const result = decompress.uncompress(new Uint8ArrayList(data));
        if (result) {
          expect(result.subarray().toString()).to.be.equal(testData);
          done();
        }
      }
    });
  });

  it("should work with huge input", function (done) {
    const testData = Buffer.alloc(100000, 4).toString();
    const compressIterable = encodeSnappy(Buffer.from(testData));
    let result = Buffer.alloc(0);
    const decompress = new SnappyFramesUncompress();

    void pipe(compressIterable, async function (source) {
      for await (const data of source) {
        // testData will come compressed as two or more chunks
        result = Buffer.concat([
          result,
          decompress.uncompress(new Uint8ArrayList(data))?.subarray() ?? Buffer.alloc(0),
        ]);
        if (result.length === testData.length) {
          expect(result.toString()).to.be.equal(testData);
          done();
        }
      }
    });
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
