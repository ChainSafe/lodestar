import {getImplementation, initNative} from "@vekexasia/bigint-buffer2";
import {beforeAll, bench, describe} from "@chainsafe/benchmark";
import {bigIntToBytes, bigIntToBytesInto} from "@lodestar/utils";

describe("bigIntToBytes", () => {
  beforeAll(async () => {
    await initNative();
    console.log(`bigint-buffer2 implementation: ${getImplementation()}`);
  });

  const testValues = [
    0n,
    255n,
    65535n,
    16777215n,
    4294967295n,
    BigInt("18446744073709551615"), // max u64
    BigInt("340282366920938463463374607431768211455"), // max u128
  ];

  // Pre-allocate buffers for "Into" methods
  const buffer8 = new Uint8Array(8);
  const buffer32 = new Uint8Array(32);

  for (const value of testValues) {
    const valueStr = value <= 1000n ? String(value) : `2^${value.toString(2).length - 1}`;

    bench({
      id: `bigIntToBytes LE ${valueStr}`,
      fn: () => {
        bigIntToBytes(value, 8, "le");
      },
    });

    bench({
      id: `bigIntToBytesInto LE ${valueStr}`,
      fn: () => {
        bigIntToBytesInto(value, buffer8, "le");
      },
    });
  }

  // Test with larger buffer (32 bytes, common for hashes/keys)
  const largeValue = BigInt("0x" + "ff".repeat(32));

  bench({
    id: "bigIntToBytes BE 32 bytes (allocating)",
    fn: () => {
      bigIntToBytes(largeValue, 32, "be");
    },
  });

  bench({
    id: "bigIntToBytesInto BE 32 bytes (pre-allocated)",
    fn: () => {
      bigIntToBytesInto(largeValue, buffer32, "be");
    },
  });

  // Test batch conversion (realistic use case)
  const batchSize = 100;
  const values = Array.from({length: batchSize}, (_, i) => BigInt(i * 1000000));

  bench({
    id: `batch ${batchSize}x bigIntToBytes (allocating)`,
    fn: () => {
      for (const v of values) {
        bigIntToBytes(v, 8, "le");
      }
    },
  });

  bench({
    id: `batch ${batchSize}x bigIntToBytesInto (reusing buffer)`,
    fn: () => {
      for (const v of values) {
        bigIntToBytesInto(v, buffer8, "le");
      }
    },
  });
});
