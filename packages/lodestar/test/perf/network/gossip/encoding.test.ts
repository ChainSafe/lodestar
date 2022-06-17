import {fromHexString} from "@chainsafe/ssz";
import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {compress, uncompress} from "snappyjs";
import {uncompress as uncompressSnappy} from "snappy";


describe("snappy comparison", () => {
  setBenchOpts({
    minRuns: 1e9,
    minMs: 60 * 1000,
    maxMs: 100 * 1000,
  });

  const attestation = "0xe4000000fed53d00000000000b00000000000000c1c7bea37b1e74310094293a3a11263525f7a5d8d2d67621f5e0825e5a37f1a0aeee010000000000b1f0033ddced8fe5636e060df211561236125fb7bdeb67eacad82f57f2438a7cafee010000000000b712789b41cdd9d60e1901e2b6b62e9bd314f539a1c9370b92c9de3c5b5a8a5c8e0f7c0a7b4e5df53220e21a594014f6f1482fa3fddf4f4145a98d048c19ef42be34fce247a528d34c5881bc2b88a6520a5833dd5cd29577f2ab915bafe7acb17824db255776d71e49ad2fd65d46fc4b296cdb629a9511ed69ab2c336c0d550f01";
  const uncompressedData = fromHexString(attestation);
  const uncompressedDataBuffer = Buffer.from(uncompressedData);
  const uncompressedData10x = Buffer.concat(Array.from({length: 10}, () => uncompressedDataBuffer));
  console.log("@@@ 10x attestation data length", uncompressedData10x.length);
  // const compressedData = compress(uncompressedData);
  const compressedData = compress(uncompressedData10x);
  const bufferCompressedData = Buffer.from(compressedData);

  itBench({
    id: "snappyjs uncompress",
    fn: () => {
      for (let i = 0; i < 1e3; i++) {
        uncompress(compressedData);
      }
    },
  });

  itBench({
    id: "snappy uncompress",
    fn: async () => {
      const promises = [];
      for (let i = 0; i < 1e3; i++) {
        promises.push(uncompressSnappy(bufferCompressedData));
      }
      await Promise.all(promises);
    }
  })
});
