import {bench, describe, setBenchOpts} from "@chainsafe/benchmark";

describe("transfer bytes", () => {
  const sizes = [
    {size: 84, name: "Status"},
    {size: 112, name: "SignedVoluntaryExit"},
    {size: 416, name: "ProposerSlashing"},
    {size: 485, name: "Attestation"},
    {size: 33_232, name: "AttesterSlashing"},
    {size: 128_000, name: "Small SignedBeaconBlock"},
    {size: 200_000, name: "Avg SignedBeaconBlock"},
    {size: 524380, name: "BlobsSidecar"},
    {size: 1_000_000, name: "Big SignedBeaconBlock"},
  ];

  setBenchOpts({noThreshold: true});

  for (const {size, name} of sizes) {
    const array = new Uint8Array(size);
    for (let i = 0; i < array.length; i++) array[i] = Math.random() * 255;
    bench({
      id: `transfer serialized ${name} (${size} B)`,
      beforeEach: () => array.slice(),
      fn: async (a) => {
        structuredClone(a, {transfer: [a.buffer]});
      },
    });
    bench({
      id: `copy serialized ${name} (${size} B)`,
      fn: async () => {
        structuredClone(array);
      },
    });
  }
});
