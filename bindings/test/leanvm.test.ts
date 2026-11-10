import {beforeAll, describe, expect, it} from "vitest";
import {
  LEANVM_AVAILABLE,
  XMSS_CLAIM_SIZE,
  XMSS_PUBLIC_KEY_SIZE,
  XMSS_SIGNATURE_SIZE,
  XMSS_SIGNED_SIZE,
  type XmssAggregate,
  XmssSecretKey,
  aggregateXmssSignatures,
  verifyXmssAggregate,
  verifyXmssSignature,
} from "../src/leanvm.js";

const LOG_INV_RATE = 2;
const MESSAGE_A = new Uint8Array(32).fill(0xaa);
const MESSAGE_B = new Uint8Array(32).fill(0xbb);

function concat(...parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts));
}

function sortedClaims(...claims: Uint8Array[]): Uint8Array {
  return concat(...claims.sort((a, b) => Buffer.compare(a, b)));
}

describe.skipIf(!LEANVM_AVAILABLE)("leanvm", () => {
  let first: XmssSecretKey;
  let second: XmssSecretKey;
  /** `first` on A, `second` on A, `first` on B. */
  let signatures: Uint8Array[];
  let claims: Uint8Array[];

  beforeAll(async () => {
    first = await XmssSecretKey.fromSeed(new Uint8Array(32).fill(1));
    second = await XmssSecretKey.generate();
    signatures = await Promise.all([first.sign(MESSAGE_A, 7), second.sign(MESSAGE_A, 7), first.sign(MESSAGE_B, 8)]);
    claims = [
      concat(first.toPublicKey(), MESSAGE_A),
      concat(second.toPublicKey(), MESSAGE_A),
      concat(first.toPublicKey(), MESSAGE_B),
    ];
  }, 60_000);

  it("derives a key from its seed", async () => {
    expect(first.toSeed()).toEqual(new Uint8Array(32).fill(1));
    expect(first.toPublicKey()).toHaveLength(XMSS_PUBLIC_KEY_SIZE);
    const again = await XmssSecretKey.fromSeed(first.toSeed());
    expect(again.toPublicKey()).toEqual(first.toPublicKey());
    expect(second.toPublicKey()).not.toEqual(first.toPublicKey());
    await expect(first.prepare(1 << 16)).resolves.toBeUndefined();
  });

  it("rejects malformed key inputs", async () => {
    await expect(XmssSecretKey.fromSeed(new Uint8Array(31))).rejects.toThrow("InvalidSeedLength");
    await expect(first.sign(new Uint8Array(31), 0)).rejects.toThrow("InvalidMessageLength");
    await expect(first.sign(MESSAGE_A, -1)).rejects.toThrow();
    expect(() => new XmssSecretKey().toPublicKey()).toThrow("KeyNotLoaded");
  });

  it("signs deterministically and verifies", async () => {
    expect(signatures[0]).toHaveLength(XMSS_SIGNATURE_SIZE);
    expect(await first.sign(MESSAGE_A, 7)).toEqual(signatures[0]);
    expect(verifyXmssSignature(first.toPublicKey(), MESSAGE_A, signatures[0])).toBe(true);
    expect(verifyXmssSignature(first.toPublicKey(), MESSAGE_B, signatures[0])).toBe(false);
    expect(verifyXmssSignature(second.toPublicKey(), MESSAGE_A, signatures[0])).toBe(false);
    expect(() => verifyXmssSignature(first.toPublicKey(), MESSAGE_A, signatures[0].subarray(1))).toThrow(
      "InvalidSignatureLength"
    );
  });

  describe("aggregation", () => {
    let root: XmssAggregate;

    beforeAll(async () => {
      const signed = claims.map((claim, i) => concat(claim, signatures[i]));
      expect(signed[0]).toHaveLength(XMSS_SIGNED_SIZE);
      const left = await aggregateXmssSignatures([], concat(signed[0], signed[1]), LOG_INV_RATE);
      const right = await aggregateXmssSignatures([], signed[2], LOG_INV_RATE);
      root = await aggregateXmssSignatures([left, right], new Uint8Array(0), LOG_INV_RATE);
    }, 120_000);

    it("claims the union of its children's claims, sorted", () => {
      expect(root.claims).toEqual(sortedClaims(...claims));
    });

    it("verifies against exactly its claims", async () => {
      expect(await verifyXmssAggregate(root.proof, root.claims)).toBe(true);
      expect(await verifyXmssAggregate(root.proof, root.claims.subarray(XMSS_CLAIM_SIZE))).toBe(false);

      const tampered = root.proof.slice();
      tampered[tampered.length - 1] ^= 1;
      expect(await verifyXmssAggregate(tampered, root.claims)).toBe(false);
      expect(await verifyXmssAggregate(new Uint8Array(7), root.claims)).toBe(false);
    });

    it("rejects malformed claims", async () => {
      const [a, b] = [
        root.claims.subarray(0, XMSS_CLAIM_SIZE),
        root.claims.subarray(XMSS_CLAIM_SIZE, 2 * XMSS_CLAIM_SIZE),
      ];
      await expect(verifyXmssAggregate(root.proof, concat(b, a))).rejects.toThrow("MalformedSignerSet");
      await expect(verifyXmssAggregate(root.proof, root.claims.subarray(1))).rejects.toThrow("InvalidClaimsLength");
    });

    it("narrows to declared claims", async () => {
      const onA = sortedClaims(claims[0], claims[1]);
      const narrowed = await aggregateXmssSignatures([root], new Uint8Array(0), LOG_INV_RATE, onA);
      expect(narrowed.claims).toEqual(onA);
      expect(await verifyXmssAggregate(narrowed.proof, onA)).toBe(true);
      expect(await verifyXmssAggregate(narrowed.proof, root.claims)).toBe(false);
    }, 60_000);

    it("rejects what it cannot prove", async () => {
      await expect(aggregateXmssSignatures([], new Uint8Array(0), LOG_INV_RATE)).rejects.toThrow("Empty");
      await expect(aggregateXmssSignatures([root], new Uint8Array(0), 9)).rejects.toThrow("InvalidRate");

      // `second` never signed B.
      const uncovered = sortedClaims(concat(second.toPublicKey(), MESSAGE_B));
      await expect(aggregateXmssSignatures([root], new Uint8Array(0), LOG_INV_RATE, uncovered)).rejects.toThrow(
        "NotCovered"
      );

      const forged = concat(claims[1], signatures[0]);
      await expect(aggregateXmssSignatures([], forged, LOG_INV_RATE)).rejects.toThrow();
      await expect(aggregateXmssSignatures([], forged.subarray(1), LOG_INV_RATE)).rejects.toThrow(
        "InvalidSignedLength"
      );
    }, 60_000);
  });
});
