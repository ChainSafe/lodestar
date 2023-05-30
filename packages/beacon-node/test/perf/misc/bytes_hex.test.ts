import crypto from "node:crypto";
import {itBench} from "@dapplion/benchmark";
import {toHexString} from "@chainsafe/ssz";

// Results in Linux Dec 2021
//
// misc / bytes32 to hex
// ✓ bytes32 toHexString                                                  1248439 ops/s    801.0000 ns/op        -     731181 runs  0.808 s
// ✓ bytes32 Buffer.toString(hex)                                         1610306 ops/s    621.0000 ns/op        -     871116 runs  0.808 s
// ✓ bytes32 Buffer.toString(hex) from Uint8Array                         1321004 ops/s    757.0000 ns/op        -     567231 runs  0.606 s
// ✓ bytes32 Buffer.toString(hex) + 0x                                    1647446 ops/s    607.0000 ns/op        -     446039 runs  0.404 s

describe("misc / bytes32 to hex", () => {
  const bytes32 = crypto.randomBytes(32);
  const uint8Arr = randomBytesUint8Array(32);

  itBench("bytes32 toHexString", () => {
    toHexString(bytes32);
  });

  itBench("bytes32 Buffer.toString(hex)", () => {
    bytes32.toString("hex");
  });

  itBench("bytes32 Buffer.toString(hex) from Uint8Array", () => {
    Buffer.from(uint8Arr).toString("hex");
  });

  itBench("bytes32 Buffer.toString(hex) + 0x", () => {
    "0x" + bytes32.toString("hex");
  });
});

function randomBytesUint8Array(bytes: number): Uint8Array {
  const buf = crypto.randomBytes(bytes);
  const uArr = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    uArr[i] = buf[i];
  }
  return uArr;
}
