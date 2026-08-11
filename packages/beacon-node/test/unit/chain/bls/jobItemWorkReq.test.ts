import {describe, expect, it} from "vitest";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {ISignatureSet, SignatureSetType} from "@lodestar/state-transition";
import {JobQueueItemType, jobItemWorkReq} from "../../../../src/chain/bls/multithread/jobItem.js";

describe("jobItemWorkReq", () => {
  const sk = SecretKey.fromBytes(Buffer.alloc(32, 1));
  const pubkey = sk.toPublicKey();
  const signingRoot = Buffer.alloc(32, 2);
  const signature = sk.sign(signingRoot).toBytes();

  const sets: ISignatureSet[] = [
    {type: SignatureSetType.single, pubkey, signingRoot, signature},
    {type: SignatureSetType.indexed, index: 7, signingRoot, signature},
    {type: SignatureSetType.aggregate, indices: [1, 2, 3], signingRoot, signature},
  ];

  it("preserves descriptors instead of resolving pubkeys on the main thread", async () => {
    const workReq = await jobItemWorkReq(
      {
        type: JobQueueItemType.default,
        resolve: () => {},
        reject: () => {},
        addedTimeMs: 0,
        opts: {batchable: true},
        sets,
      },
      null
    );

    expect(workReq.sets).toEqual([
      {type: "single", publicKey: pubkey.toBytes(), message: signingRoot, signature},
      {type: "indexed", index: 7, message: signingRoot, signature},
      {type: "aggregate", indices: [1, 2, 3], message: signingRoot, signature},
    ]);
  });
});
