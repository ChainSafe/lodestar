import {describe, it, expect, beforeAll} from "vitest";
import {toBufferBE} from "bigint-buffer";
import {toHexString} from "@chainsafe/ssz";
import {SecretKey} from "@chainsafe/blst";
import {getApiClientStub} from "../../utils/apiStub.js";
import {testLogger} from "../../utils/logger.js";
import {IndicesService} from "../../../src/services/indices.js";

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
});
