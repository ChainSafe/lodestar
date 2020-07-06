import pipe from "it-pipe";
import {eth2ResponseDecode, eth2ResponseEncode, encodeP2pErrorMessage, decodeP2pErrorMessage} from "../../../../src/network/encoders/response";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../../../src/constants";
import {collect} from "../../chain/blocks/utils";
import {expect} from "chai";
import {createStatus} from "./utils";
import {IResponseChunk} from "../../../../src/network/encoders/interface";
import {generateEmptySignedBlock} from "../../../utils/block";
import {ResponseBody, SignedBeaconBlock, Status} from "@chainsafe/lodestar-types";
import {encode} from "varint";
import {fail} from "assert";
import {randomRequestId} from "../../../../src/network";

describe("response decoders", function () {

  let loggerStub: SinonStubbedInstance<ILogger>;

  beforeEach(function () {
    loggerStub = sinon.createStubInstance(WinstonLogger);
  });

  it("should work - no response - ssz", async function () {
    const responses = await pipe(
      [],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - no response - ssz_snappy", async function () {
    const responses = await pipe(
      [],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - single error - ssz", async function () {
    const responses = await pipe(
      [{status: 1}],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - single error - ssz_snappy", async function () {
    const responses = await pipe(
      [{status: 1}],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - single response simple- ssz", async function () {
    const responses = await pipe(
      [{status: 0, body:BigInt(1)}],
      eth2ResponseEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Ping.equals(BigInt(1), responses[0])).to.be.true;
  });

  it("should work - single response simple - ssz_snappy", async function () {
    const responses = await pipe(
      [{status: 0, body:BigInt(1)}],
      eth2ResponseEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Ping.equals(BigInt(1), responses[0])).to.be.true;
  });

  it("should work - single response simple (sent multiple)- ssz", async function () {
    const responses = await pipe(
      [{status: 0, body:BigInt(1)}, {status: 0, body:BigInt(1)}],
      eth2ResponseEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Ping.equals(BigInt(1), responses[0])).to.be.true;
  });

  it("should work - single response simple (sent multiple) - ssz_snappy", async function () {
    const responses = await pipe(
      [{status: 0, body:BigInt(1)}, {status: 0, body:BigInt(1)}],
      eth2ResponseEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Ping.equals(BigInt(1), responses[0])).to.be.true;
  });

  it("should work - single response complex- ssz", async function () {
    const status = createStatus();
    const responses = await pipe(
      [{status: 0, body: status}],
      eth2ResponseEncode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Status.equals(status, responses[0])).to.be.true;
  });

  it("should work - single response complex - ssz_snappy", async function () {
    const status = createStatus();
    const responses = await pipe(
      [{status: 0, body: status}],
      eth2ResponseEncode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY, "abc"),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Status.equals(status, responses[0])).to.be.true;
  });

  it("should work - response stream- ssz", async function () {
    const chunks = generateBlockChunks(10);
    const responses = await pipe(
      chunks,
      eth2ResponseEncode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ, "abc"),
      collect
    ) as ResponseBody[];
    expect(responses.length).to.be.equal(10);
    responses.forEach((response, i) => {
      expect(
        config.types.SignedBeaconBlock.equals(chunks[i].body as SignedBeaconBlock, response as SignedBeaconBlock)
      ).to.be.true;
    });
  });

  it("should work - response stream - ssz_snappy", async function () {
    const chunks = generateBlockChunks(10);
    const responses = await pipe(
      chunks,
      eth2ResponseEncode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ_SNAPPY, "abc"),
      collect
    ) as ResponseBody[];
    expect(responses.length).to.be.equal(10);
    responses.forEach((response, i) => {
      expect(
        config.types.SignedBeaconBlock.equals(chunks[i].body as SignedBeaconBlock, response as SignedBeaconBlock)
      ).to.be.true;
    });
  });

  it("should work - response stream with error - ssz", async function () {
    const chunks = generateBlockChunks(10);
    chunks[4].status = RpcResponseStatus.ERR_INVALID_REQ;
    chunks[4].body = encodeP2pErrorMessage(config, "Invalid request");
    const responses = await pipe(
      chunks,
      eth2ResponseEncode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ, "abc"),
      collect
    ) as ResponseBody[];
    expect(responses.length).to.be.equal(4);
  });

  it("should work - response stream with error - ssz_snappy", async function () {
    const chunks = generateBlockChunks(10);
    chunks[5].status = RpcResponseStatus.ERR_INVALID_REQ;
    const responses = await pipe(
      chunks,
      eth2ResponseEncode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ_SNAPPY, "abc"),
      collect
    ) as ResponseBody[];
    expect(responses.length).to.be.equal(5);
  });

  describe("eth2ResponseDecode - response validation", () => {
    it("should throw Error if it takes more than 10 bytes for varint", async () => {
      try {
        await pipe(
          [Buffer.concat([Buffer.alloc(1), Buffer.from(encode(99999999999999999999999))])],
          eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ_SNAPPY, randomRequestId()),
          collect
        );
        fail("expect error here");
      } catch (err) {
        expect(err.message).to.be.equal("eth2ResponseDecode: Invalid number of bytes for protobuf varint 11, method beacon_blocks_by_range");
      }
    });

    it("should should throw Error if failed ssz size bound validation", async function () {
      try {
        await pipe(
          [Buffer.concat([Buffer.alloc(1), Buffer.alloc(12, 0)])],
          eth2ResponseDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY, randomRequestId()),
          collect
        );
        fail("expect error here");
      } catch (err) {
        expect(err.message).to.be.equal("eth2ResponseDecode: Invalid szzLength of 0 for method status");
      }
    });

    it("should throw Error if it read more than maxEncodedLen", async function () {
      try {
        await pipe(
          [Buffer.concat([Buffer.alloc(1),
            Buffer.from(encode(config.types.Status.minSize())),
            Buffer.alloc(config.types.Status.minSize() + 10)])],
          eth2ResponseDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ, randomRequestId()),
          collect
        );
        fail("expect error here");
      } catch (err) {
        expect(err.message).to.be.equal("eth2ResponseDecode: too much bytes read (94) for method status, sszLength 84");
      }
    });

    it("should throw Error if there is remaining data after all", async function () {
      try {
        await pipe(
          [Buffer.concat([Buffer.alloc(1),
            Buffer.from(encode(config.types.Status.minSize())),
            Buffer.alloc(config.types.Status.minSize())])],
          eth2ResponseDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY, randomRequestId()),
          collect
        );
        fail("expect error here");
      } catch (err) {
        expect(err.message).to.be.equal("There is remaining data not deserialized for method status");
      }
    });

    it("should yield correct ResponseBody", async function () {
      const status: Status = config.types.Status.defaultValue();
      status.finalizedEpoch = 100;
      const response = await pipe(
        [Buffer.concat([Buffer.alloc(1),
          Buffer.from(encode(config.types.Status.minSize())),
          config.types.Status.serialize(status)])],
        eth2ResponseDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ, randomRequestId()),
        collect
      );
      expect(response).to.be.deep.equal([status]);
    });

  });

  describe("encodeP2pErrorMessage", () => {
    it("should encode and decode error message correctly", () => {
      const err = encodeP2pErrorMessage(config, "Invalid request");
      expect(decodeP2pErrorMessage(config, err)).to.be.equal("Invalid request");
    });
  });

});

function generateBlockChunks(n = 3): IResponseChunk[] {
  return Array.from({length: n}).map(() => ({status: 0, body: generateEmptySignedBlock()} as IResponseChunk));
}
