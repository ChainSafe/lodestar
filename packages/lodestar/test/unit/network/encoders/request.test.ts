import pipe from "it-pipe";
import {eth2RequestDecode, eth2RequestEncode} from "../../../../src/network/encoders/request";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Method, ReqRespEncoding} from "../../../../src/constants";
import {collect} from "../../chain/blocks/utils";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {createStatus} from "./utils";
import {encode} from "varint";
import {Status} from "@chainsafe/lodestar-types";


describe("request encoders", function () {

  let loggerStub: SinonStubbedInstance<ILogger>;

  beforeEach(function () {
    loggerStub = sinon.createStubInstance(WinstonLogger);
  });

  it("should work - basic request - ssz", async function () {
    const requests = await pipe(
      [0n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2RequestDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Uint64.equals(requests[0].body, 1n)).to.be.true;
  });

  it("should work - basic request - ssz_snappy", async function () {
    const requests = await pipe(
      [0n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      eth2RequestDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Uint64.equals(requests[0].body, 1n)).to.be.true;
  });

  it("should work - container request - ssz", async function () {
    const status = createStatus();
    const requests = await pipe(
      [status],
      eth2RequestEncode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
      eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Status.equals(requests[0].body, status)).to.be.true;
  });

  it("should work - container request - ssz", async function () {
    const status = createStatus();
    const requests = await pipe(
      [status],
      eth2RequestEncode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
      eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Status.equals(requests[0].body, status)).to.be.true;
  });

  it("should work - multiple request - ssz", async function () {
    const requests = await pipe(
      [1n, 2n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2RequestDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Uint64.equals(requests[0].body, 1n)).to.be.true;
  });

  it("should work - multiple request - ssz_snappy", async function () {
    const requests = await pipe(
      [1n, 2n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      eth2RequestDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Uint64.equals(requests[0].body, 1n)).to.be.true;
  });

  it("should work - no request body - ssz", async function () {
    const requests = await pipe(
      [],
      eth2RequestDecode(config, loggerStub, Method.Metadata, ReqRespEncoding.SSZ),
      collect
    );
    expect(requests.length).to.be.equal(1);
  });

  it("should work - no request body - ssz_snappy", async function () {
    const requests = await pipe(
      [],
      eth2RequestDecode(config, loggerStub, Method.Metadata, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(requests.length).to.be.equal(1);
  });

  it("should warn user if failed to encode request", async function () {
    await pipe(
      [1n],
      eth2RequestEncode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
      eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
      collect
    );
    expect(loggerStub.warn.calledOnce).to.be.true;
  });

  describe("eth2RequestDecode - request validation", () => {
    it("should yield {isValid: false} if it takes more than 10 bytes for varint", async function () {
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.from(encode(99999999999999999999999))],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
        collect
      );
      expect(validatedRequestBody).to.be.deep.equal([{isValid: false}]);
      const err = "eth2RequestDecode: Invalid number of bytes for protobuf varint 11, method status";
      expect(loggerStub.error.calledOnceWith(err)).to.be.true;
    });

    it("should yield {isValid: false} if failed ssz size bound validation", async function () {
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.alloc(12, 0)],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
        collect
      );
      expect(validatedRequestBody).to.be.deep.equal([{isValid: false}]);
      const err = "eth2RequestDecode: Invalid szzLength of 0 for method status";
      expect(loggerStub.error.calledOnceWith(err)).to.be.true;
    });


    it("should yield {isValid: false} if it read more than maxEncodedLen", async function () {
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.from(encode(config.types.Status.minSize())), Buffer.alloc(config.types.Status.minSize() + 10)],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
        collect
      );
      expect(validatedRequestBody).to.be.deep.equal([{isValid: false}]);
      const err = "eth2RequestDecode: too much bytes read (94) for method status, sszLength 84";
      expect(loggerStub.error.calledOnceWith(err)).to.be.true;
    });

    it("should yield {isValid: false} if failed ssz snappy input malformed", async function () {
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.from(encode(config.types.Status.minSize())), Buffer.from("wrong snappy data")],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
        collect
      );
      expect(validatedRequestBody).to.be.deep.equal([{isValid: false}]);
      const err = "Failed to decompress request data. Error: Unsupported snappy chunk type";
      expect(loggerStub.error.calledOnceWith(err)).to.be.true;
    });

    it("should yield correct RequestBody if correct ssz", async function () {
      const status: Status = config.types.Status.defaultValue();
      status.finalizedEpoch = 100;
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.from(encode(config.types.Status.minSize())), config.types.Status.serialize(status)],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
        collect
      );
      expect(validatedRequestBody).to.be.deep.equal([{isValid: true, body: status}]);
    });
  });
});
