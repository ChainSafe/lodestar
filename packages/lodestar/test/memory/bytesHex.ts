import {toHexString} from "@chainsafe/ssz";
import crypto from "crypto";
import {testRunnerMemory} from "./testRunnerMemory";

// Results in Linux Dec 2021
//
// Bytes32 toHexString()                      - 901.1 bytes / instance
// Bytes32 Buffer.toString(hex)               - 85.4 bytes / instance
// Bytes32 Buffer.toString(hex) Buffer.from() - 84.8 bytes / instance
// Bytes32 Buffer.toString(hex) + 0x          - 121.7 bytes / instance

testRunnerMemoryBpi([
  {
    id: "Bytes32 toHexString()",
    getInstance: () => toHexString(crypto.randomBytes(32)),
  },
  {
    id: "Bytes32 Buffer.toString(hex)",
    getInstance: () => crypto.randomBytes(32).toString("hex"),
  },
  {
    id: "Bytes32 Buffer.toString(hex) Buffer.from()",
    getInstance: () => Buffer.from(crypto.randomBytes(32)).toString("hex"),
  },
  {
    id: "Bytes32 Buffer.toString(hex) + 0x",
    getInstance: () => "0x" + crypto.randomBytes(32).toString("hex"),
  },
]);

/**
 * Test bytes per instance in different representations of raw binary data
 */
function testRunnerMemoryBpi(testCases: {getInstance: (bytes: number) => unknown; id: string}[]): void {
  const longestId = Math.max(...testCases.map(({id}) => id.length));

  for (const {id, getInstance} of testCases) {
    const bpi = testRunnerMemory({
      getInstance,
      convergeFactor: 0.2 / 100,
    });

    // eslint-disable-next-line no-console
    console.log(`${id.padEnd(longestId)} - ${bpi.toFixed(1)} bytes / instance`);
  }
}
