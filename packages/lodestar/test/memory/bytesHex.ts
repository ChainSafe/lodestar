import {toHexString} from "@chainsafe/ssz";
import crypto from "node:crypto";
import {testRunnerMemory} from "./testRunnerMemory";

// Results in Linux Dec 2021
//
// Bytes32 toHexString()                        - 902.8 bytes / instance
// Bytes32 Buffer.toString(hex)                 - 86.9 bytes / instance
// Bytes32 Buffer.toString(hex) from Uint8Array - 87.6 bytes / instance
// Bytes32 Buffer.toString(hex) + 0x            - 121.7 bytes / instance
// Bytes32 randomBytes32Template()              - 924.7 bytes / instance

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
    id: "Bytes32 Buffer.toString(hex) from Uint8Array",
    getInstance: () => Buffer.from(randomBytesUint8Array(32)).toString("hex"),
  },
  {
    id: "Bytes32 Buffer.toString(hex) + 0x",
    getInstance: () => "0x" + crypto.randomBytes(32).toString("hex"),
  },
  {
    id: "Bytes32 randomBytes32Template()",
    getInstance: () => randomBytes32Template(),
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

function randomBytesUint8Array(bytes: number): Uint8Array {
  const buf = crypto.randomBytes(bytes);
  const uArr = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) {
    uArr[i] = buf[i];
  }
  return uArr;
}

function randomBytes32Template(): string {
  const buf = crypto.randomBytes(32);
  return `${buf[0]}${buf[1]}${buf[2]}${buf[3]}${buf[4]}${buf[5]}${buf[6]}${buf[7]}${buf[8]}${buf[9]}${buf[10]}${buf[11]}${buf[12]}${buf[13]}${buf[14]}${buf[15]}${buf[16]}${buf[17]}${buf[18]}${buf[19]}${buf[20]}${buf[21]}${buf[22]}${buf[23]}${buf[24]}${buf[25]}${buf[26]}${buf[27]}${buf[28]}${buf[29]}${buf[30]}${buf[31]}`;
}
