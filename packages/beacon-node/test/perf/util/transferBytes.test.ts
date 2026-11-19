import {bench, describe, setBenchOpts} from "@chainsafe/benchmark";

/**
 * This shows how fast the transfer of bytes between workers is compared to a simple copy.
 * Disable by default because it's not lodestar code.
 *   transfer bytes
    ✔ transfer serialized Status (84 B)                                   232504.1 ops/s    4.301000 us/op   x1.968      39313 runs  0.320 s
    ✔ copy serialized Status (84 B)                                       413736.0 ops/s    2.417000 us/op   x2.029      79160 runs  0.344 s
    ✔ transfer serialized SignedVoluntaryExit (112 B)                     233644.9 ops/s    4.280000 us/op   x1.912      65063 runs  0.535 s
    ✔ copy serialized SignedVoluntaryExit (112 B)                         434593.7 ops/s    2.301000 us/op   x1.895     105903 runs  0.453 s
    ✔ transfer serialized ProposerSlashing (416 B)                        243013.4 ops/s    4.115000 us/op   x1.800      38143 runs  0.321 s
    ✔ copy serialized ProposerSlashing (416 B)                            360360.4 ops/s    2.775000 us/op   x2.202      85781 runs  0.444 s
    ✔ transfer serialized Attestation (485 B)                             238948.6 ops/s    4.185000 us/op   x1.809      38342 runs  0.320 s
    ✔ copy serialized Attestation (485 B)                                 438020.1 ops/s    2.283000 us/op   x1.777      97506 runs  0.459 s
    ✔ transfer serialized AttesterSlashing (33232 B)                      228937.7 ops/s    4.368000 us/op   x1.734      28449 runs  0.419 s
    ✔ copy serialized AttesterSlashing (33232 B)                          129148.9 ops/s    7.743000 us/op   x1.797      21674 runs  0.310 s
    ✔ transfer serialized Small SignedBeaconBlock (128000 B)              183553.6 ops/s    5.448000 us/op   x1.328      10288 runs  0.408 s
    ✔ copy serialized Small SignedBeaconBlock (128000 B)                  11670.25 ops/s    85.68800 us/op   x6.069       2868 runs  0.405 s
    ✔ transfer serialized Avg SignedBeaconBlock (200000 B)                199561.0 ops/s    5.011000 us/op   x1.172      12879 runs  0.727 s
    ✔ copy serialized Avg SignedBeaconBlock (200000 B)                    12585.90 ops/s    79.45400 us/op   x4.288       2916 runs  0.408 s
    ✔ transfer serialized BlobsSidecar (524380 B)                         189501.6 ops/s    5.277000 us/op   x1.025       1896 runs  0.474 s
    ✔ copy serialized BlobsSidecar (524380 B)                             5294.703 ops/s    188.8680 us/op   x1.702       1268 runs  0.546 s
    ✔ transfer serialized Big SignedBeaconBlock (1000000 B)               167084.4 ops/s    5.985000 us/op   x1.134       1443 runs  0.514 s
    ✔ copy serialized Big SignedBeaconBlock (1000000 B)                   6337.457 ops/s    157.7920 us/op   x1.246       1200 runs  0.521 s
 */
describe.skip("transfer bytes", () => {
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
