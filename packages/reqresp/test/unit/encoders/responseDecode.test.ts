import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import all from "it-all";
import {pipe} from "it-pipe";
import {LodestarError} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {responseDecode} from "../../../src/encoders/responseDecode.js";
import {responseEncodersErrorTestCases, responseEncodersTestCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {arrToSource, onlySuccessResp} from "../../utils/index.js";
import {ContextBytesType} from "../../../src/types.js";

chai.use(chaiAsPromised);

describe("encoders / responseDecode", () => {
  describe("valid cases", () => {
    for (const {id, protocol, responseChunks, chunks} of responseEncodersTestCases) {
      it(`${id}`, async () => {
        const responses = await pipe(
          arrToSource(chunks),
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          responseDecode(protocol, {onFirstHeader: () => {}, onFirstResponseChunk: () => {}}),
          all
        );

        const successResponses: unknown[] = responseChunks.filter(onlySuccessResp).map((r) => {
          const bytes = r.payload.bytes;
          const fork =
            r.payload.contextBytes.type === ContextBytesType.Empty ? ForkName.phase0 : r.payload.contextBytes.fork;

          return protocol.responseType(fork).deserialize(bytes) as unknown;
        });

        expect(successResponses).to.deep.equal(responses);
      });
    }
  });

  describe("error cases", () => {
    for (const {id, protocol, chunks, decodeError} of responseEncodersErrorTestCases.filter(
      (r) => r.decodeError !== undefined
    )) {
      it(`${id}`, async () => {
        await expectRejectedWithLodestarError(
          pipe(
            arrToSource(chunks as Uint8Array[]),
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            responseDecode(protocol, {onFirstHeader: () => {}, onFirstResponseChunk: () => {}}),
            all
          ),
          decodeError as LodestarError<any>
        );
      });
    }
  });
});
