import {ChainForkConfig} from "@lodestar/config";
import {CompactMultiProof, ProofType} from "@chainsafe/persistent-merkle-tree";
import {Api, ReqTypes, routesData, getReqSerializers} from "../routes/proof.js";
import {IHttpClient, getFetchOptsSerializers, HttpError} from "../../utils/client/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";

/**
 * REST HTTP client for lightclient routes
 */
export function getClient(_config: ChainForkConfig, httpClient: IHttpClient): Api {
  const reqSerializers = getReqSerializers();

  // For `getStateProof()` generate request serializer
  const fetchOptsSerializers = getFetchOptsSerializers<Api, ReqTypes>(routesData, reqSerializers);

  return {
    async getStateProof(stateId, descriptor) {
      try {
        const res = await httpClient.arrayBuffer(fetchOptsSerializers.getStateProof(stateId, descriptor));
        // reuse the response ArrayBuffer
        if (!Number.isInteger(res.body.byteLength / 32)) {
          throw new Error("Invalid proof data: Length not divisible by 32");
        }

        const proof: CompactMultiProof = {
          type: ProofType.compactMulti,
          descriptor,
          leaves: Array.from({length: res.body.byteLength / 32}, (_, i) => new Uint8Array(res.body, i * 32, 32)),
        };

        return {ok: true, response: {data: proof}, status: HttpStatusCode.OK};
      } catch (err) {
        if (err instanceof HttpError) {
          return {
            ok: false,
            error: {code: err.status, message: err.message, operationId: "proof.getStateProof"},
            status: err.status,
          };
        }
        throw err;
      }
    },
    async getBlockProof(blockId, descriptor) {
      try {
        const res = await httpClient.arrayBuffer(fetchOptsSerializers.getBlockProof(blockId, descriptor));
        // reuse the response ArrayBuffer
        if (!Number.isInteger(res.body.byteLength / 32)) {
          throw new Error("Invalid proof data: Length not divisible by 32");
        }

        const proof: CompactMultiProof = {
          type: ProofType.compactMulti,
          descriptor,
          leaves: Array.from({length: res.body.byteLength / 32}, (_, i) => new Uint8Array(res.body, i * 32, 32)),
        };

        return {ok: true, response: {data: proof}, status: HttpStatusCode.OK};
      } catch (err) {
        if (err instanceof HttpError) {
          return {
            ok: false,
            error: {code: err.status, message: err.message, operationId: "proof.getStateProof"},
            status: err.status,
          };
        }
        throw err;
      }
    },
  };
}
