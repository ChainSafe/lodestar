import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {compress, uncompress} from "snappyjs";
import {uncompress as uncompressSnappy} from "snappy";
import {fromHexString} from "@chainsafe/ssz";

describe("snappy comparison", function () {
  this.timeout(0);
  setBenchOpts({
    minRuns: 1e9,
    minMs: 60 * 1000,
    maxMs: 100 * 1000,
  });

  const attestationHex =
    "0xe4000000fed53d00000000000b00000000000000c1c7bea37b1e74310094293a3a11263525f7a5d8d2d67621f5e0825e5a37f1a0aeee010000000000b1f0033ddced8fe5636e060df211561236125fb7bdeb67eacad82f57f2438a7cafee010000000000b712789b41cdd9d60e1901e2b6b62e9bd314f539a1c9370b92c9de3c5b5a8a5c8e0f7c0a7b4e5df53220e21a594014f6f1482fa3fddf4f4145a98d048c19ef42be34fce247a528d34c5881bc2b88a6520a5833dd5cd29577f2ab915bafe7acb17824db255776d71e49ad2fd65d46fc4b296cdb629a9511ed69ab2c336c0d550f01";
  const uncompressedAttData = Buffer.from(fromHexString(attestationHex));

  for (const attTimes of [1, 100, 500]) {
    const uncompressedData = Buffer.concat(Array.from({length: attTimes}, () => uncompressedAttData));
    console.log("@@@ uncompressed data length", uncompressedData.length);
    const compressedData = Buffer.from(compress(uncompressedData));

    itBench({
      id: `snappyjs uncompress ${attTimes} Attestation size - ${Math.floor(uncompressedData.length / 10) / 100} kb`,
      fn: () => {
        for (let i = 0; i < 1e3; i++) {
          uncompress(compressedData);
        }
      },
    });

    itBench({
      id: `snappy uncompress ${attTimes} Attestation size - ${Math.floor(uncompressedData.length / 10) / 100} kb`,
      fn: async () => {
        await Promise.all(Array.from({length: 1e3}, () => uncompressSnappy(compressedData)));
      },
    });
  }
});
