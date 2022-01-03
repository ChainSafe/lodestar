import crypto from "crypto";
import {itBench} from "@dapplion/benchmark";
import {toHexString} from "@chainsafe/ssz";

// Results in Linux Dec 2021
//
// misc / bytes32 to hex
// ✓ bytes32 toHexString                                                  1184834 ops/s    844.0000 ns/op        -     346342 runs  0.404 s
// ✓ bytes32 Buffer.toString(hex)                                         1669449 ops/s    599.0000 ns/op        -     775931 runs  0.707 s
// ✓ bytes32 Buffer.toString(hex) + 0x                                    1683502 ops/s    594.0000 ns/op        -     670067 runs  0.606 s

describe("misc / bytes32 to hex", () => {
  const bytes32 = crypto.randomBytes(32);

  itBench("bytes32 toHexString", () => {
    toHexString(bytes32);
  });

  itBench("bytes32 Buffer.toString(hex)", () => {
    bytes32.toString("hex");
  });

  itBench("bytes32 Buffer.toString(hex) + 0x", () => {
    "0x" + bytes32.toString("hex");
  });
});
