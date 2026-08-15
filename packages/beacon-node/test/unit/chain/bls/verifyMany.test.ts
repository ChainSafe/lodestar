import {describe, expect, it} from "vitest";
import {BLS_VERIFIER_SET_TYPE, type BlsSignatureSet} from "@chainsafe/lodestar-z/bls-verifier";
import {type BlsWorkReq, JobQueueItemType, WorkResultCode} from "../../../../src/chain/bls/multithread/types.js";
import {type NativeBlsVerifier, verifyManySignatureSets} from "../../../../src/chain/bls/multithread/verifyMany.js";

const setA = indexedSet(1);
const setB = indexedSet(2);

describe("verifyManySignatureSets", () => {
  it("combines batchable requests and preserves critical priority", async () => {
    const calls: {sets: BlsSignatureSet[]; critical: boolean}[] = [];
    const verifier: NativeBlsVerifier = {
      async verify(sets, critical) {
        calls.push({sets, critical});
        return true;
      },
      async verifySameMessage() {
        throw Error("unexpected same-message call");
      },
    };

    const result = await verifyManySignatureSets(
      [defaultReq([setA], {batchable: true}), defaultReq([setB], {batchable: true, priority: true})],
      verifier
    );

    expect(calls).toEqual([{sets: [setA, setB], critical: true}]);
    expect(result.batchRetries).toBe(0);
    expect(result.batchSigsSuccess).toBe(2);
    expect(result.results).toEqual([
      {code: WorkResultCode.success, result: [true]},
      {code: WorkResultCode.success, result: [true]},
    ]);
  });

  it("falls back per request after an invalid combined batch", async () => {
    const calls: BlsSignatureSet[][] = [];
    const verifier: NativeBlsVerifier = {
      async verify(sets) {
        calls.push(sets);
        if (sets.length > 1) return false;
        return sets[0] === setA;
      },
      async verifySameMessage() {
        throw Error("unexpected same-message call");
      },
    };

    const result = await verifyManySignatureSets(
      [defaultReq([setA], {batchable: true}), defaultReq([setB], {batchable: true})],
      verifier
    );

    expect(calls).toEqual([[setA, setB], [setA], [setB]]);
    expect(result.batchRetries).toBe(1);
    expect(result.batchSigsSuccess).toBe(0);
    expect(result.results).toEqual([
      {code: WorkResultCode.success, result: [true]},
      {code: WorkResultCode.success, result: [false]},
    ]);
  });

  it("keeps same-message verification on its specialized path", async () => {
    const sameMessageCalls: {critical: boolean; message: Uint8Array}[] = [];
    const verifier: NativeBlsVerifier = {
      async verify() {
        throw Error("unexpected general call");
      },
      async verifySameMessage(_sets, message, critical) {
        sameMessageCalls.push({critical, message});
        return [true];
      },
    };
    const message = new Uint8Array(32).fill(3);
    const req: BlsWorkReq = {
      type: JobQueueItemType.sameMessage,
      opts: {priority: true},
      sets: [{index: 1, signature: new Uint8Array(96)}],
      message,
    };

    const result = await verifyManySignatureSets([req], verifier);

    expect(sameMessageCalls).toEqual([{critical: true, message}]);
    expect(result.results).toEqual([{code: WorkResultCode.success, result: [true]}]);
  });
});

function defaultReq(sets: BlsSignatureSet[], opts: {batchable?: boolean; priority?: boolean}): BlsWorkReq {
  return {type: JobQueueItemType.default, opts, sets};
}

function indexedSet(index: number): BlsSignatureSet {
  return {
    type: BLS_VERIFIER_SET_TYPE.indexed,
    index,
    message: new Uint8Array(32),
    signature: new Uint8Array(96),
  };
}
