import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import pipe from "it-pipe";
import {allForks} from "@chainsafe/lodestar-types";
import all from "it-all";
import {ForkName} from "@chainsafe/lodestar-params";
import {
  Method,
  Version,
  Encoding,
  OutgoingResponseBody,
  getResponseSzzTypeByMethod,
  IncomingResponseBodyByMethod,
} from "../../../../../src/network/reqresp/types";
import {responseDecode} from "../../../../../src/network/reqresp/encoders/responseDecode";
import {responseEncodeSuccess} from "../../../../../src/network/reqresp/encoders/responseEncode";
import {arrToSource, createStatus, generateEmptySignedBlocks} from "../utils";
import {expectIsEqualSszTypeArr} from "../../../../utils/ssz";
import {config} from "../../../../utils/config";
import {blocksToReqRespBlockResponses} from "../../../../utils/block";

chai.use(chaiAsPromised);

// Ensure the types from all methods are supported properly
describe("network / reqresp / encoders / responseTypes", () => {
  const testCases: {[P in keyof IncomingResponseBodyByMethod]: IncomingResponseBodyByMethod[P][][]} = {
    [Method.Status]: [[createStatus()]],
    [Method.Goodbye]: [[BigInt(0)], [BigInt(1)]],
    [Method.Ping]: [[BigInt(0)], [BigInt(1)]],
    [Method.Metadata]: [],
    [Method.BeaconBlocksByRange]: [generateEmptySignedBlocks(2)],
    [Method.BeaconBlocksByRoot]: [generateEmptySignedBlocks(2)],
  };

  const encodings: Encoding[] = [Encoding.SSZ_SNAPPY];

  // TODO: Test endcoding through a fork
  const forkName = ForkName.phase0;

  for (const encoding of encodings) {
    for (const [_method, responsesChunks] of Object.entries(testCases)) {
      // Cast to more generic types, type by index is useful only at declaration of `testCases`
      const method = _method as keyof typeof testCases;
      // const responsesChunks = _responsesChunks as LodestarResponseBody[][];
      const lodestarResponseBodies =
        _method === Method.BeaconBlocksByRange || _method === Method.BeaconBlocksByRoot
          ? responsesChunks.map((chunk) => blocksToReqRespBlockResponses(chunk as allForks.SignedBeaconBlock[]))
          : (responsesChunks as OutgoingResponseBody[][]);

      const versions =
        method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot
          ? [Version.V1, Version.V2]
          : [Version.V1];

      for (const version of versions) {
        for (const [i, responseChunks] of responsesChunks.entries()) {
          it(`${encoding} v${version} ${method} - resp ${i}`, async function () {
            const protocol = {method, version, encoding};
            const returnedResponses = await pipe(
              arrToSource(lodestarResponseBodies[i]),
              responseEncodeSuccess(config, protocol),
              responseDecode(config, protocol),
              all
            );

            const type = getResponseSzzTypeByMethod(protocol, forkName);
            if (type === undefined) throw Error("no type");

            expectIsEqualSszTypeArr(type, returnedResponses, responseChunks, "Response chunks");
          });
        }
      }
    }
  }
});
