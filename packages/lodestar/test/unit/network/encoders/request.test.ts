import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import sinon, {SinonStubbedInstance} from "sinon";
import {encode} from "varint";
import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {ILogger, WinstonLogger} from "@chainsafe/lodestar-utils";
import {RequestBody, Status} from "@chainsafe/lodestar-types";
import {eth2RequestDecode, streamRequestBodyTo} from "../../../../src/network/encoders/request";
import {IValidatedRequestBody} from "../../../../src/network/encoders/interface";
import {Method, ReqRespEncoding} from "../../../../src/constants";
import {ReqRespSerializeError} from "../../../../src/network/error";
import {silentLogger} from "../../../utils/logger";
import {createStatus} from "./utils";

chai.use(chaiAsPromised);

describe("network / encoders", () => {
  describe("request encoder", () => {
    for (const encoding of [ReqRespEncoding.SSZ, ReqRespEncoding.SSZ_SNAPPY]) {
      it(`simulate request basic - ${encoding}`, async function () {
        const requestBody = BigInt(0);
        const returnedRequest = await simulateRequest(Method.Ping, encoding, requestBody);

        expect(config.types.Uint64.equals(returnedRequest.body as typeof requestBody, requestBody)).to.be.true;
      });

      it(`simulate request container - ${encoding}`, async function () {
        const requestBody = createStatus();
        const returnedRequest = await simulateRequest(Method.Status, encoding, requestBody);

        expect(config.types.Status.equals(returnedRequest.body as typeof requestBody, requestBody)).to.be.true;
      });

      it(`simulate request bad body - ${encoding}`, async function () {
        const requestBody = BigInt(0);

        await expect(simulateRequest(Method.Status, encoding, requestBody)).to.be.rejectedWith(ReqRespSerializeError);
      });
    }

    async function simulateRequest(
      method: Method,
      encoding: ReqRespEncoding,
      requestBody: RequestBody
    ): Promise<IValidatedRequestBody> {
      let decodedRequestBody: IValidatedRequestBody[] = [];
      async function streamSink(source: any): Promise<void> {
        decodedRequestBody = await all(eth2RequestDecode(config, silentLogger, method, encoding)(source));
      }

      await streamRequestBodyTo(config, method, encoding, requestBody, streamSink as any);

      return decodedRequestBody[0];
    }
  });

  describe("request decoder", () => {
    const logger = silentLogger;
    let loggerStub: SinonStubbedInstance<ILogger>;

    beforeEach(function () {
      loggerStub = sinon.createStubInstance(WinstonLogger);
    });

    it("should yield {isValid: false} if it takes more than 10 bytes for varint", async function () {
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.from(encode(99999999999999999999999))],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
        all
      );

      expect(validatedRequestBody).to.be.deep.equal([{isValid: false}]);
      const err = "eth2RequestDecode: Invalid number of bytes for protobuf varint";
      expect(loggerStub.error.calledOnceWith(err)).to.be.true;
    });

    it("should yield {isValid: false} if failed ssz size bound validation", async function () {
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.alloc(12, 0)],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
        all
      );

      expect(validatedRequestBody).to.be.deep.equal([{isValid: false}]);
      const err = "eth2RequestDecode: Invalid szzLength";
      expect(loggerStub.error.calledOnceWith(err)).to.be.true;
    });

    it("should yield {isValid: false} if it read more than maxEncodedLen", async function () {
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.from(encode(config.types.Status.minSize())), Buffer.alloc(config.types.Status.minSize() + 10)],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ),
        all
      );

      expect(validatedRequestBody).to.be.deep.equal([{isValid: false}]);
      const err = "eth2RequestDecode: too much bytes read";
      expect(loggerStub.error.calledOnceWith(err)).to.be.true;
    });

    it("should yield {isValid: false} if failed ssz snappy input malformed", async function () {
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.from(encode(config.types.Status.minSize())), Buffer.from("wrong snappy data")],
        eth2RequestDecode(config, loggerStub, Method.Status, ReqRespEncoding.SSZ_SNAPPY),
        all
      );

      expect(validatedRequestBody).to.be.deep.equal([{isValid: false}]);
      const err = "Failed to decompress request data";
      expect(loggerStub.error.calledOnceWith(err)).to.be.true;
    });

    it("should yield correct RequestBody if correct ssz", async function () {
      const status: Status = config.types.Status.defaultValue();
      status.finalizedEpoch = 100;
      const validatedRequestBody: unknown[] = await pipe(
        [Buffer.from(encode(config.types.Status.minSize())), config.types.Status.serialize(status)],
        eth2RequestDecode(config, logger, Method.Status, ReqRespEncoding.SSZ),
        all
      );

      expect(validatedRequestBody).to.be.deep.equal([{isValid: true, body: status}]);
    });
  });
});
