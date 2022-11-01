import {pipe} from "it-pipe";
import all from "it-all";
import {allForks, ssz} from "@lodestar/types";
import {ForkName} from "@lodestar/params";
import {
  Method,
  Version,
  Encoding,
  OutgoingResponseBody,
  getResponseSzzTypeByMethod,
  IncomingResponseBodyByMethod,
} from "../../../../../src/network/reqresp/types.js";
import {responseDecode} from "../../../../../src/network/reqresp/encoders/responseDecode.js";
import {responseEncodeSuccess} from "../../../../../src/network/reqresp/encoders/responseEncode.js";
import {arrToSource, createStatus, generateEmptySignedBlocks} from "../utils.js";
import {expectIsEqualSszTypeArr} from "../../../../utils/ssz.js";
import {config} from "../../../../utils/config.js";
import {blocksToReqRespBlockResponses} from "../../../../utils/block.js";

// Ensure the types from all methods are supported properly
describe("network / reqresp / encoders / responseTypes", () => {
  const testCases: {[P in keyof IncomingResponseBodyByMethod]: IncomingResponseBodyByMethod[P][][]} = {
    [Method.Status]: [[createStatus()]],
    [Method.Goodbye]: [[BigInt(0)], [BigInt(1)]],
    [Method.Ping]: [[BigInt(0)], [BigInt(1)]],
    [Method.Metadata]: [],
    [Method.BeaconBlocksByRange]: [generateEmptySignedBlocks(2)],
    [Method.BeaconBlocksByRoot]: [generateEmptySignedBlocks(2)],
    [Method.LightClientBootstrap]: [[ssz.altair.LightClientBootstrap.defaultValue()]],
    [Method.LightClientUpdate]: [[ssz.altair.LightClientUpdate.defaultValue()]],
    [Method.LightClientFinalityUpdate]: [[ssz.altair.LightClientFinalityUpdate.defaultValue()]],
    [Method.LightClientOptimisticUpdate]: [[ssz.altair.LightClientOptimisticUpdate.defaultValue()]],
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
              // eslint-disable-next-line @typescript-eslint/no-empty-function
              responseDecode(config, protocol, {onFirstHeader: () => {}, onFirstResponseChunk: () => {}}),
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
