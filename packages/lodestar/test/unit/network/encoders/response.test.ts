import pipe from "it-pipe";
import {eth2ResponseDecode, eth2ResponseEncode} from "../../../../src/network/encoders/response";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import sinon, {SinonStubbedInstance} from "sinon";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Method, ReqRespEncoding, RpcResponseStatus} from "../../../../src/constants";
import {collect} from "../../chain/blocks/utils";
import {expect} from "chai";
import {createStatus} from "./utils";
import {IResponseChunk} from "../../../../src/network/encoders/interface";
import {generateEmptySignedBlock} from "../../../utils/block";
import {ResponseBody, SignedBeaconBlock} from "@chainsafe/lodestar-types";

describe("response decoders", function () {

  let loggerStub: SinonStubbedInstance<ILogger>;
    
  beforeEach(function () {
    loggerStub = sinon.createStubInstance(WinstonLogger);
  });
    
  it("should work - no response - ssz", async function () {
    const responses = await pipe(
      [],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - no response - ssz_snappy", async function () {
    const responses = await pipe(
      [],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - single error - ssz", async function () {
    const responses = await pipe(
      [{status: 1}],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - single error - ssz_snappy", async function () {
    const responses = await pipe(
      [{status: 1}],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - no response (but sent) - ssz", async function () {
    const responses = await pipe(
      [{status: 0, body: 1n}],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - no response (but sent) - ssz_snappy", async function () {
    const responses = await pipe(
      [{status: 0, body: 1n}],
      eth2ResponseEncode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Goodbye, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(responses.length).to.be.equal(0);
  });

  it("should work - single response simple- ssz", async function () {
    const responses = await pipe(
      [{status: 0, body: 1n}],
      eth2ResponseEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Ping.equals(1n, responses[0])).to.be.true;
  });

  it("should work - single response simple - ssz_snappy", async function () {
    const responses = await pipe(
      [{status: 0, body: 1n}],
      eth2ResponseEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Ping.equals(1n, responses[0])).to.be.true;
  });

  it("should work - single response simple (sent multiple)- ssz", async function () {
    const responses = await pipe(
      [{status: 0, body: 1n}, {status: 0, body: 1n}],
      eth2ResponseEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Ping.equals(1n, responses[0])).to.be.true;
  });

  it("should work - single response simple (sent multiple) - ssz_snappy", async function () {
    const responses = await pipe(
      [{status: 0, body: 1n}, {status: 0, body: 1n}],
      eth2ResponseEncode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      eth2ResponseDecode(config, loggerStub, Method.Ping, ReqRespEncoding.SSZ_SNAPPY),
      collect
    );
    expect(responses.length).to.be.equal(1);
    expect(config.types.Ping.equals(1n, responses[0])).to.be.true;
  });

  it("should work - single response complex- ssz", async function () {
    const status = createStatus();
    const responses = await pipe(
      [{status: 0, body: status}],
      eth2ResponseEncode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
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
      eth2ResponseDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
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
      eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ),
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
      eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ_SNAPPY),
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
    const responses = await pipe(
      chunks,
      eth2ResponseEncode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ),
      eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ),
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
      eth2ResponseDecode(config, loggerStub, Method.BeaconBlocksByRange, ReqRespEncoding.SSZ_SNAPPY),
      collect
    ) as ResponseBody[];
    expect(responses.length).to.be.equal(5);
  });
    
});

function generateBlockChunks(n = 3): IResponseChunk[] {
  return Array.from({length: n}).map(() => ({status: 0, body: generateEmptySignedBlock()} as IResponseChunk));
}