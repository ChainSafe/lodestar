import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import all from "it-all";
import {config} from "@chainsafe/lodestar-config/minimal";
import {phase0} from "@chainsafe/lodestar-types";
import {Method, Methods, ReqRespEncoding} from "../../../../../src/constants";
import {responseDecode} from "../../../../../src/network/reqresp/encoders/responseDecode";
import {responseEncodeSuccess} from "../../../../../src/network/reqresp/encoders/responseEncode";
import {arrToSource, createStatus, generateEmptySignedBlocks} from "../utils";
import {expectIsEqualSszTypeArr} from "../../../../utils/ssz";

chai.use(chaiAsPromised);

describe("network / reqresp / encoders / encodeDecodeResponse", () => {
  interface IResponseTypes {
    [Method.Status]: phase0.Status;
    [Method.Goodbye]: phase0.Goodbye;
    [Method.Ping]: phase0.Ping;
    [Method.Metadata]: phase0.Metadata;
    [Method.BeaconBlocksByRange]: phase0.SignedBeaconBlock;
    [Method.BeaconBlocksByRoot]: phase0.SignedBeaconBlock;
  }

  const testCases: {[P in keyof IResponseTypes]: IResponseTypes[P][][]} = {
    [Method.Status]: [[createStatus()]],
    [Method.Goodbye]: [[BigInt(0)], [BigInt(1)]],
    [Method.Ping]: [[BigInt(0)], [BigInt(1)]],
    [Method.Metadata]: [],
    [Method.BeaconBlocksByRange]: [generateEmptySignedBlocks(2)],
    [Method.BeaconBlocksByRoot]: [generateEmptySignedBlocks(2)],
  };

  const encodings: ReqRespEncoding[] = [ReqRespEncoding.SSZ_SNAPPY];

  for (const encoding of encodings) {
    for (const [_method, _responsesChunks] of Object.entries(testCases)) {
      // Cast to more generic types, type by index is useful only at declaration of `testCases`
      const method = _method as keyof typeof testCases;
      const responsesChunks = _responsesChunks as phase0.ResponseBody[][];

      responsesChunks.forEach((responseChunks, i) => {
        it(`${encoding} ${method} - resp ${i}`, async function () {
          const returnedResponses = await pipe(
            arrToSource(responseChunks),
            responseEncodeSuccess(config, method, encoding),
            responseDecode(config, method, encoding),
            all
          );

          const type = Methods[method].responseSSZType(config);
          if (!type) throw Error("no type");

          expectIsEqualSszTypeArr(type, returnedResponses, responseChunks, "Response chunks");
        });
      });
    }
  }
});
