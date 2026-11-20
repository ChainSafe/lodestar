import {toBufferBE} from "@vekexasia/bigint-buffer2";
import {beforeAll, describe, expect, it} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {SecretKey} from "@lodestar/native/blst";
import {toRequestPubkey} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {IndicesService} from "../../../src/services/indices.js";
import {getApiClientStub, mockApiResponse} from "../../utils/apiStub.js";
import {testLogger} from "../../utils/logger.js";

describe("IndicesService", () => {
  const logger = testLogger();
  const api = getApiClientStub();

  let pubkeys: Uint8Array[]; // Initialize pubkeys in before() so bls is already initialized

  beforeAll(() => {
    const secretKeys = [
      SecretKey.fromBytes(toBufferBE(BigInt(98), 32)),
      SecretKey.fromBytes(toBufferBE(BigInt(99), 32)),
    ];
    pubkeys = secretKeys.map((sk) => sk.toPublicKey().toBytes());
  });

  it("Should remove pubkey", async () => {
    const indicesService = new IndicesService(logger, api, null);
    const firstValidatorIndex = 0;
    const secondValidatorIndex = 1;

    const pubkey1 = toHexString(pubkeys[firstValidatorIndex]);
    const pubkey2 = toHexString(pubkeys[secondValidatorIndex]);

    indicesService.index2pubkey.set(firstValidatorIndex, pubkey1);
    indicesService.index2pubkey.set(secondValidatorIndex, pubkey2);

    indicesService.pubkey2index.set(pubkey1, firstValidatorIndex);
    indicesService.pubkey2index.set(pubkey2, secondValidatorIndex);

    // remove pubkey2
    indicesService.removeForKey(pubkey2);

    expect(Object.fromEntries(indicesService.index2pubkey)).toEqual({
      "0": `${pubkey1}`,
    });

    expect(Object.fromEntries(indicesService.pubkey2index)).toEqual({
      [`${pubkey1}`]: 0,
    });
  });

  it("names a pq validator by its bare key to the API and checks its VRF root", async () => {
    const xmssPubkey = new Uint8Array(32).fill(7);
    const known = toHex(toRequestPubkey(xmssPubkey));
    const validator = {...ssz.pq.Validator.defaultValue(), pubkey: xmssPubkey, vrfRoot: new Uint8Array(32).fill(1)};
    api.beacon.postStateValidators.mockResolvedValue(
      mockApiResponse({
        data: [{index: 5, balance: 0, status: "active_ongoing", validator}],
        meta: {executionOptimistic: false, finalized: false},
      })
    );
    const errors: string[] = [];
    const indicesService = new IndicesService({...logger, error: (message: string) => errors.push(message)}, api, null);

    expect(await indicesService.pollValidatorIndices([known], () => new Uint8Array(32).fill(2))).toEqual([5]);
    expect(api.beacon.postStateValidators).toHaveBeenCalledWith({stateId: "head", validatorIds: [toHex(xmssPubkey)]});
    expect(indicesService.pubkey2index.get(known)).toBe(5);
    expect(errors).toHaveLength(1);
  });
});
