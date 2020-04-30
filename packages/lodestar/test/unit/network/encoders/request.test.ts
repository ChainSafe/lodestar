import pipe from "it-pipe";
import {eth2RequestDecode, eth2RequestEncode} from "../../../../src/network/encoders/request";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {Method, ReqRespEncoding} from "../../../../src/constants";
import {collect} from "../../chain/blocks/utils";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {createStatus} from "./utils";

describe("request encoders", function () {
    
  let loggerStub: SinonStubbedInstance<ILogger>;
    
  beforeEach(function () {
    loggerStub = sinon.createStubInstance(WinstonLogger);
  });

  it("should work - basic request - ssz", async function () {
    const requests = await pipe(
      [1n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2RequestDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Uint64.equals(requests[0], 1n)).to.be.true;
  });

  it("should work - basic request - ssz_snappy", async function () {
    const requests = await pipe(
      [1n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      eth2RequestDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Uint64.equals(requests[0], 1n)).to.be.true;
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
    expect(config.types.Status.equals(requests[0], status)).to.be.true;
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
    expect(config.types.Status.equals(requests[0], status)).to.be.true;
  });

  it("should work - multiple request - ssz", async function () {
    const requests = await pipe(
      [1n, 2n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2RequestDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Uint64.equals(requests[0], 1n)).to.be.true;
  });

  it("should work - multiple request - ssz_snappy", async function () {
    const requests = await pipe(
      [1n, 2n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      eth2RequestDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(requests.length).to.be.equal(1);
    expect(config.types.Uint64.equals(requests[0], 1n)).to.be.true;
  });

  it("should work - no request body - ssz", async function () {
    const requests = await pipe(
      [],
      eth2RequestEncode(config, loggerStub, Method.Metadata, ReqRespEncoding.SSZ),
      eth2RequestDecode(config, loggerStub, Method.Metadata, ReqRespEncoding.SSZ),
      collect
    );
    expect(requests.length).to.be.equal(0);
  });

  it("should work - no request body - ssz_snappy", async function () {
    const requests = await pipe(
      [],
      eth2RequestEncode(config, loggerStub, Method.Metadata, ReqRespEncoding.SSZ_SNAPPY),
      eth2RequestDecode(config, loggerStub, Method.Metadata, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(requests.length).to.be.equal(0);
  });
  
  it("should warn user if failed to decode request", async function () {
    await pipe(
      [1n],
      eth2RequestEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
      collect
    );
    expect(loggerStub.warn.calledOnce).to.be.true;
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

  it("should warn user if failed ssz snappy input malformed", async function () {
    await pipe(
      [Buffer.alloc(12, 0)],
      eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(loggerStub.warn.calledOnce).to.be.true;
  });
    
});