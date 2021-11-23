import {expect} from "chai";
import {createCompressStream} from "@chainsafe/snappy-stream";
import {SnappyFramesUncompress} from "../../../../../../../src/network/reqresp/encodingStrategies/sszSnappy/snappyFrames/uncompress";

describe("snappy frames uncompress", function () {
  it("should work with short input", function (done) {
    const compressStream = createCompressStream();

    const decompress = new SnappyFramesUncompress();

    const testData = "Small test data";

    compressStream.on("data", function (data) {
      const result = decompress.uncompress(data);
      if (result) {
        expect(result.toString()).to.be.equal(testData);
        done();
      }
    });

    compressStream.write(testData);
  });

  it("should work with huge input", function (done) {
    const compressStream = createCompressStream();

    const decompress = new SnappyFramesUncompress();

    const testData = Buffer.alloc(100000, 4).toString();

    compressStream.on("data", function (data) {
      const result = decompress.uncompress(data);
      if (result) {
        expect(result.toString()).to.be.equal(testData);
        done();
      }
    });

    compressStream.write(testData);
  });

  it("should detect malformed input", function () {
    const decompress = new SnappyFramesUncompress();

    expect(() => decompress.uncompress(Buffer.alloc(32, 5))).to.throw();
  });

  it("should return null if not enough data", function () {
    const decompress = new SnappyFramesUncompress();

    expect(decompress.uncompress(Buffer.alloc(3, 1))).to.be.null;
  });
});
