import crypto from "node:crypto";
import {beforeEach, describe, expect, it} from "vitest";
import {
  PublicKey,
  SecretKey,
  Signature,
  aggregatePublicKeys,
  aggregateSerializedPublicKeys,
  aggregateVerify,
  fastAggregateVerify,
  verify,
  verifyMultipleAggregateSignatures,
} from "../src/blst.js";

describe("blst", () => {
  describe("PublicKey", () => {
    it("should deserialize from bytes", () => {
      const pk = PublicKey.fromBytes(fromHex(TEST_VECTORS.publicKey.compressed));
      expect(pk).toBeDefined();
    });

    it("should deserialize from hex", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
      expect(pk).toBeDefined();
    });

    it("should take uncompressed byte arrays", () => {
      expectEqualHex(
        PublicKey.fromHex(TEST_VECTORS.publicKey.uncompressed).toBytes(false),
        fromHex(TEST_VECTORS.publicKey.uncompressed)
      );
      expectEqualHex(
        PublicKey.fromHex(TEST_VECTORS.publicKey.uncompressed).toBytes(),
        fromHex(TEST_VECTORS.publicKey.compressed)
      );
    });
    describe("argument validation", () => {
      for (const [type, invalid] of invalidInputs) {
        it(`should throw on invalid pkBytes type: ${type}`, () => {
          expect(() => PublicKey.fromHex(invalid)).to.throw();
        });
      }
      it("should throw incorrect length pkBytes", () => {
        expect(() => PublicKey.fromBytes(Buffer.alloc(12, "*"))).to.throw("BadEncoding");
      });
    });

    it("should serialize to bytes", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.uncompressed);
      const bytes = pk.toBytes(false);
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(96);
      expect(Buffer.from(bytes).toString("hex")).toBe(
        Buffer.from(fromHex(TEST_VECTORS.publicKey.uncompressed)).toString("hex")
      );
      expect(pk.toHex(false)).toBe(`0x${Buffer.from(fromHex(TEST_VECTORS.publicKey.uncompressed)).toString("hex")}`);
    });

    it("should throw on invalid key", () => {
      expect(() => PublicKey.fromBytes(sullyUint8Array(fromHex(TEST_VECTORS.publicKey.compressed)))).to.throw(
        "BadEncoding"
      );
    });

    it("should throw on zero key", () => {
      const G1_POINT_AT_INFINITY =
        "c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

      expect(() => PublicKey.fromBytes(Buffer.from(G1_POINT_AT_INFINITY))).to.throw("BadEncoding");
    });
  });

  describe("Signature", () => {
    describe("fromBytes()", () => {
      it("should take uncompressed byte arrays", () => {
        expectEqualHex(
          Signature.fromBytes(fromHex(TEST_VECTORS.signature.uncompressed)).toBytes(false),
          fromHex(TEST_VECTORS.signature.uncompressed)
        );
      });
      it("should take compressed byte arrays", () => {
        expectEqualHex(
          Signature.fromBytes(fromHex(TEST_VECTORS.signature.compressed)).toBytes(false),
          fromHex(TEST_VECTORS.signature.uncompressed)
        );
      });
    });

    describe("fromHex()", () => {
      const G2_POINT_AT_INFINITY = `c0${"00".repeat(95)}`;

      it("should check infinity by default", () => {
        expect(() => Signature.fromHex(G2_POINT_AT_INFINITY, true)).toThrow("PkIsInfinity");
      });

      it("should skip the infinity check when explicitly disabled", () => {
        expect(Signature.fromHex(G2_POINT_AT_INFINITY, true, false)).toBeInstanceOf(Signature);
      });
    });

    it("should serialize to bytes", () => {
      const sig = Signature.fromBytes(fromHex(TEST_VECTORS.signature.compressed));
      const bytes = sig.toBytes();
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(96);
      expect(Buffer.from(bytes).toString("hex")).toBe(
        Buffer.from(fromHex(TEST_VECTORS.signature.compressed)).toString("hex")
      );
      expect(sig.toHex()).toBe(`0x${Buffer.from(fromHex(TEST_VECTORS.signature.compressed)).toString("hex")}`);
    });

    describe("argument validation", () => {
      for (const [type, invalid] of invalidInputs) {
        it(`should throw on invalid pkBytes type: ${type}`, () => {
          expect(() => Signature.fromBytes(invalid)).to.throw();
        });
      }
    });

    it("should throw on invalid length", () => {
      expect(() => Signature.fromBytes(new Uint8Array(95))).toThrow();
    });

    it("should reject PublicKey objects when aggregating", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
      expect(() => Signature.aggregate([pk as unknown as Signature], false)).toThrow("TypeMismatch");
    });

    it("should aggregate Signature objects", () => {
      const signatures = getTestSets(2).map((set) => set.sig);
      expect(Signature.aggregate(signatures, false)).toBeInstanceOf(Signature);
    });
  });

  describe("SecretKey", () => {
    describe("SecretKey.fromKeygen", () => {
      it("should create an instance from Uint8Array ikm", () => {
        expect(SecretKey.fromKeygen(KEY_MATERIAL)).to.be.instanceOf(SecretKey);
      });
      it("should create the same key from the same ikm", () => {
        expectEqualHex(SecretKey.fromKeygen(KEY_MATERIAL).toBytes(), SecretKey.fromKeygen(KEY_MATERIAL).toBytes());
      });
      it("should take a second 'info' argument", () => {
        expectNotEqualHex(
          SecretKey.fromKeygen(KEY_MATERIAL, Uint8Array.from(Buffer.from("some fancy info"))).toBytes(),
          SecretKey.fromKeygen(KEY_MATERIAL).toBytes()
        );
      });
      describe("argument validation", () => {
        const validInfoTypes = ["undefined", "null", "string"];
        for (const [type, invalid] of invalidInputs) {
          it(`should throw on invalid ikm type: ${type}`, () => {
            expect(() => SecretKey.fromKeygen(invalid, undefined)).to.throw();
          });
          if (!validInfoTypes.includes(type)) {
            it(`should throw on invalid info type: ${type}`, () => {
              expect(() => SecretKey.fromKeygen(KEY_MATERIAL, invalid)).to.throw();
            });
          }
        }
        it("should throw incorrect length ikm", () => {
          expect(() => SecretKey.fromKeygen(Buffer.alloc(12, "*"))).to.throw("InvalidSeedLength");
        });
      });
    });
    describe("SecretKey.fromBytes", () => {
      it("should create an instance", () => {
        expect(SecretKey.fromBytes(SECRET_KEY_BYTES)).to.be.instanceOf(SecretKey);
      });
      describe("argument validation", () => {
        for (const [type, invalid] of invalidInputs) {
          it(`should throw on invalid ikm type: ${type}`, () => {
            expect(() => SecretKey.fromBytes(invalid)).to.throw();
          });
        }
      });
    });
    describe("SecretKey.fromHex", () => {
      for (const prefix of ["", "0x"]) {
        it(`should round-trip a valid key with prefix '${prefix}'`, () => {
          const hex = `${prefix}${Buffer.from(SECRET_KEY_BYTES).toString("hex")}`;
          expectEqualHex(SecretKey.fromHex(hex).toBytes(), SECRET_KEY_BYTES);
        });
      }

      for (const byteLength of [0, 1, 31, 33]) {
        for (const prefix of ["", "0x"]) {
          it(`should throw on ${byteLength}-byte input with prefix '${prefix}'`, () => {
            expect(() => SecretKey.fromHex(`${prefix}${"00".repeat(byteLength)}`)).toThrow("InvalidSecretKeyLength");
          });
        }
      }

      it("should throw on an odd number of hex characters", () => {
        expect(() => SecretKey.fromHex("0".repeat(63))).toThrow("InvalidSecretKeyLength");
      });

      it("should throw on non-hex UTF-8 input without aborting", () => {
        expect(() => SecretKey.fromHex("é".repeat(32))).toThrow();
      });
    });
    describe("instance methods", () => {
      let key: SecretKey;
      describe("toBytes", () => {
        beforeEach(() => {
          key = SecretKey.fromBytes(SECRET_KEY_BYTES);
        });
        it("should toBytes the key to Uint8Array", () => {
          expect(key.toBytes()).to.be.instanceof(Uint8Array);
        });
        it("should be the correct length", () => {
          expect(key.toBytes().length).to.equal(32);
        });
        it("should reconstruct the same key", () => {
          const serialized = key.toBytes();
          expectEqualHex(SecretKey.fromBytes(serialized).toBytes(), serialized);
          expect(key.toHex()).toBe(`0x${Buffer.from(SECRET_KEY_BYTES).toString("hex")}`);
        });
      });
      describe("toPublicKey", () => {
        it("should create a valid PublicKey", () => {
          const key = SecretKey.fromBytes(SECRET_KEY_BYTES);
          const pk = key.toPublicKey();
          expect(pk).to.be.instanceOf(PublicKey);
          expect(pk.validate()).to.be.undefined;
        });
        it("should return the same PublicKey from the same SecretKey", () => {
          const sk = SecretKey.fromBytes(SECRET_KEY_BYTES);
          const pk1 = sk.toPublicKey().toBytes();
          const pk2 = sk.toPublicKey().toBytes();
          expectEqualHex(pk1, pk2);
        });
      });
      describe("sign", () => {
        it("should create a valid Signature for a 32-byte signing root", () => {
          const sig = SecretKey.fromKeygen(KEY_MATERIAL, undefined).sign(new Uint8Array(32));
          expect(sig).to.be.instanceOf(Signature);
          expect(sig.validate(false)).to.be.undefined;
        });

        for (const length of [31, 33]) {
          it(`should throw InvalidMessageLength for a ${length}-byte signing root`, () => {
            const sk = SecretKey.fromKeygen(KEY_MATERIAL, undefined);
            expect(() => sk.sign(new Uint8Array(length))).toThrow("InvalidMessageLength");
          });
        }
      });
    });
  });

  describe("verify", () => {
    it("should verify valid signature", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
      const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
      const result = verify(TEST_VECTORS.message, pk, sig, false, false);
      expect(result).toBe(true);
    });

    it("should reject wrong message", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
      const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
      const wrongMessage = new Uint8Array(32).fill(0);
      const result = verify(wrongMessage, pk, sig, false, false);
      expect(result).toBe(false);
    });

    for (const length of [31, 33]) {
      it(`should throw InvalidMessageLength for a ${length}-byte signing root`, () => {
        const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
        const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
        expect(() => verify(new Uint8Array(length), pk, sig, false, false)).toThrow("InvalidMessageLength");
      });
    }
  });

  describe("aggregateVerify", () => {
    it("should return a boolean", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
      const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
      expect(aggregateVerify([TEST_VECTORS.message], [pk], sig)).to.be.a("boolean");
    });
    describe("should default to false", () => {
      it("should handle invalid message", () => {
        const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
        const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
        expect(aggregateVerify([sullyUint8Array(TEST_VECTORS.message)], [pk], sig)).to.be.false;
      });
    });
    it("should return true for valid sets", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
      const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
      expect(aggregateVerify([TEST_VECTORS.message], [pk], sig)).to.be.true;
    });

    for (const length of [31, 33]) {
      it(`should throw InvalidMessageLength for a ${length}-byte signing root`, () => {
        const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
        const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
        expect(() => aggregateVerify([new Uint8Array(length)], [pk], sig)).toThrow("InvalidMessageLength");
      });
    }
  });

  describe("fastAggregateVerify", () => {
    it("should verify with single pubkey", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
      const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
      const result = fastAggregateVerify(TEST_VECTORS.message, [pk], sig, false);
      expect(result).toBe(true);
    });

    it("should return false for empty pubkeys", () => {
      const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
      const result = fastAggregateVerify(TEST_VECTORS.message, [], sig, false);
      expect(result).toBe(false);
    });

    it("should reject wrong message", () => {
      const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
      const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
      const wrongMessage = new Uint8Array(32).fill(0);
      const result = fastAggregateVerify(wrongMessage, [pk], sig, false);
      expect(result).toBe(false);
    });

    for (const length of [31, 33]) {
      it(`should throw InvalidMessageLength for a ${length}-byte signing root`, () => {
        const pk = PublicKey.fromHex(TEST_VECTORS.publicKey.compressed);
        const sig = Signature.fromHex(TEST_VECTORS.signature.compressed);
        expect(() => fastAggregateVerify(new Uint8Array(length), [pk], sig, false)).toThrow("InvalidMessageLength");
      });
    }
  });

  describe("verifyMultipleAggregateSignatures", () => {
    it("should return true for valid sets", () => {
      expect(verifyMultipleAggregateSignatures(getTestSets(6), false, false)).to.be.true;
    });

    it("should return false for invalid sets", () => {
      const sets = getTestSets(6);
      sets[0].sig = sets[1].sig;
      expect(verifyMultipleAggregateSignatures(sets, false, false)).to.be.false;
    });

    it("should reject objects of the wrong class", () => {
      const [{msg, pk, sig, sk}] = getTestSets(1);
      expect(() =>
        verifyMultipleAggregateSignatures([{msg, pk: sk as unknown as PublicKey, sig}], false, false)
      ).toThrow("TypeMismatch");
      expect(() =>
        verifyMultipleAggregateSignatures([{msg, pk, sig: pk as unknown as Signature}], false, false)
      ).toThrow("TypeMismatch");
    });

    for (const length of [31, 33]) {
      it(`should throw InvalidMessageLength for a ${length}-byte signing root`, () => {
        const [set] = getTestSets(1);
        expect(() => verifyMultipleAggregateSignatures([{...set, msg: new Uint8Array(length)}], false, false)).toThrow(
          "InvalidMessageLength"
        );
      });
    }
  });

  describe("aggregatePublicKeys", () => {
    it("should reject SecretKey objects", () => {
      const sk = SecretKey.fromBytes(SECRET_KEY_BYTES);
      expect(() => aggregatePublicKeys([sk as unknown as PublicKey])).toThrow("TypeMismatch");
    });
  });

  describe("aggregateSerializedPublicKeys", () => {
    it("should aggregate compressed (48-byte) public keys", () => {
      const sets = getTestSets(3);
      const compressed = sets.map((s) => s.pk.toBytes()); // default is compressed (48 bytes)
      expect(compressed[0].length).toBe(48);
      const agg = aggregateSerializedPublicKeys(compressed);
      expect(agg).toBeInstanceOf(PublicKey);
      expect(() => agg.validate()).not.toThrow();
    });

    it("should aggregate uncompressed (96-byte) public keys", () => {
      const sets = getTestSets(3);
      const uncompressed = sets.map((s) => s.pk.toBytes(false)); // uncompressed (96 bytes)
      expect(uncompressed[0].length).toBe(96);
      const agg = aggregateSerializedPublicKeys(uncompressed);
      expect(agg).toBeInstanceOf(PublicKey);
      expect(() => agg.validate()).not.toThrow();
    });

    it("should produce the same result as aggregatePublicKeys", () => {
      const sets = getTestSets(3);
      const fromObjects = aggregatePublicKeys(
        sets.map((s) => s.pk),
        false
      );
      const fromCompressed = aggregateSerializedPublicKeys(
        sets.map((s) => s.pk.toBytes()),
        false
      );
      const fromUncompressed = aggregateSerializedPublicKeys(
        sets.map((s) => s.pk.toBytes(false)),
        false
      );
      expectEqualHex(fromCompressed.toBytes(), fromObjects.toBytes());
      expectEqualHex(fromUncompressed.toBytes(), fromObjects.toBytes());
    });

    it("should throw on empty array", () => {
      expect(() => aggregateSerializedPublicKeys([])).toThrow();
    });

    it("should throw on invalid length bytes", () => {
      expect(() => aggregateSerializedPublicKeys([new Uint8Array(32)])).toThrow();
    });
  });
});

const DEFAULT_TEST_MESSAGE = Uint8Array.from(Buffer.from("lodestarlodestarlodestarlodestar"));

function buildTestSetFromMessage(msg: Uint8Array = DEFAULT_TEST_MESSAGE): TestSet {
  const sk = SecretKey.fromKeygen(crypto.randomBytes(32));
  const pk = sk.toPublicKey();
  const sig = sk.sign(msg);
  try {
    pk.validate();
  } catch {
    console.log(">>>\n>>>\n>>> Invalid Key Found in a TestSet\n>>>\n>>>");
    return buildTestSetFromMessage(msg);
  }
  try {
    sig.validate(false);
  } catch {
    console.log(">>>\n>>>\n>>> Invalid Signature Found in a TestSet\n>>>\n>>>");
    return buildTestSetFromMessage(msg);
  }
  return {
    msg,
    pk,
    sig,
    sk,
  };
}

interface TestSet {
  msg: Uint8Array;
  sk: SecretKey;
  pk: PublicKey;
  sig: Signature;
}

const testSets = new Map<number, TestSet>();
function buildTestSet(i: number): TestSet {
  const message = crypto.randomBytes(32);
  const set = buildTestSetFromMessage(message);
  testSets.set(i, set);
  return set;
}

function getTestSets(count: number): TestSet[] {
  return arrayOfIndexes(0, count - 1).map(getTestSet);
}

function arrayOfIndexes(start: number, end: number): number[] {
  const arr: number[] = [];
  for (let i = start; i <= end; i++) arr.push(i);
  return arr;
}

function getTestSet(i = 0): TestSet {
  const set = testSets.get(i);
  if (set) {
    return set;
  }
  return buildTestSet(i);
}

function fromHex(str: string): Uint8Array {
  var hexStr = str;
  if (str.startsWith("0x")) hexStr = str.slice(2);
  return Uint8Array.from(Buffer.from(hexStr, "hex"));
}

// Test vectors generated with @chainsafe/blst using seed Buffer.alloc(32, "*")
const TEST_VECTORS = {
  message: DEFAULT_TEST_MESSAGE,
  publicKey: {
    compressed: "8ae7e5822ba97ab07877ea318e747499da648b27302414f9d0b9bb7e3646d248be90c9fdaddfdb93485a6e9334f01093",
    uncompressed:
      "0ae7e5822ba97ab07877ea318e747499da648b27302414f9d0b9bb7e3646d248be90c9fdaddfdb93485a6e9334f0109301f36856007e1bc875ab1b00dbf47f9ead16c5562d889d8b270002ade81e78d473204fcb51ede8659bce3d95c67903bc",
  },
  signature: {
    compressed:
      "81faa68cb2d12b67c54a5a8ac52a7f351f187e4a4f446296c46d56b961159d52ad34a3015cff5753743c1ac2ec7ddbb708dc18431e8b9a53738a5fd08db1981711ae7f6669b9f0486c20546e3bd9e7a1d6cf239563a4b4ffbe0f572086c735aa",
    uncompressed:
      "01faa68cb2d12b67c54a5a8ac52a7f351f187e4a4f446296c46d56b961159d52ad34a3015cff5753743c1ac2ec7ddbb708dc18431e8b9a53738a5fd08db1981711ae7f6669b9f0486c20546e3bd9e7a1d6cf239563a4b4ffbe0f572086c735aa0aa269bc3fccc963c752b96499f0ba79750ca53eb90a0feb116387b59e40baa427f75bea3094ae9123d35cd543db9e1d07a95a35d5f7371f7315306603c41c473b8bf3af1a812c5ee121cfcdb73536ad28631ded94f86e97684f5f8a0bbd0a3d",
  },
};

const invalidInputs: [string, any][] = [
  ["boolean", true],
  ["number", 2],
  ["bigint", BigInt("2")],
  ["symbol", Symbol("foo")],
  ["null", null],
  ["undefined", undefined],
  ["object", {foo: "bar"}],
  ["proxy", new Proxy({foo: "bar"}, {})],
  ["date", new Date("1982-03-24T16:00:00-06:00")],
  [
    "function",
    () => {
      /* no-op */
    },
  ],
  ["NaN", NaN],
  ["promise", Promise.resolve()],
  ["Uint16Array", new Uint16Array()],
  ["Uint32Array", new Uint32Array()],
  ["Map", new Map()],
  ["Set", new Set()],
];

const KEY_MATERIAL = Uint8Array.from(Buffer.alloc(32, "123"));

const SECRET_KEY_BYTES = Uint8Array.from(
  Buffer.from("5620799c63c92bb7912122070f7ebb6ddd53bdf9aa63e7a7bffc177f03d14f68", "hex")
);

function sullyUint8Array(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(
    Buffer.from([...Uint8Array.prototype.slice.call(bytes, 8), ...Buffer.from("0123456789abcdef", "hex")])
  );
}

function expectEqualHex(value: Uint8Array, expected: Uint8Array): void {
  expect(Buffer.from(value).toString("hex")).to.equal(Buffer.from(expected).toString("hex"));
}

function expectNotEqualHex(value: Uint8Array, expected: Uint8Array): void {
  expect(Buffer.from(value).toString("hex")).to.not.equal(Buffer.from(expected).toString("hex"));
}
