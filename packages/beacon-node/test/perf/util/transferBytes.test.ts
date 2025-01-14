import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {expect} from "chai";

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
    itBench({
      id: `transfer serialized ${name} (${size} B)`,
      beforeEach: () => array.slice(),
      fn: async (a) => {
        structuredClone(a, {transfer: [a.buffer]});
      },
    });
    itBench({
      id: `copy serialized ${name} (${size} B)`,
      fn: async () => {
        structuredClone(array);
      },
    });
  }

  it("ArrayBuffer use after structuredClone transfer", () => {
    const data = new Uint8Array(32);
    data[0] = 1;
    expect(data[0]).equals(1);
    structuredClone(data, {transfer: [data.buffer]});
    // After structuredClone() data is mutated in place to hold an empty ArrayBuffer
    expect(data[0]).equals(undefined);
    expect(data).deep.equals(new Uint8Array());
  });
});
