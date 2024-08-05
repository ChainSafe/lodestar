import {randomBytes} from "node:crypto";
import * as snappyjs from "snappyjs";
import * as snappy from "snappy";
import {itBench} from "@dapplion/benchmark";
import snappyWasm from "@chainsafe/snappy-wasm";

/* 2024-08-05 - Linux 5.15 x86_64 - Node.js v22.4.1

  network / gossip / snappy
    compress
      ✔ 100 bytes - compress - snappyjs                                     335566.9 ops/s    2.980032 us/op        -        685 runs   2.54 s
      ✔ 100 bytes - compress - snappy                                       388610.3 ops/s    2.573272 us/op        -        870 runs   2.74 s
      ✔ 100 bytes - compress - snappy-wasm                                  583254.0 ops/s    1.714519 us/op        -        476 runs   1.32 s
      ✔ 100 bytes - compress - snappy-wasm - prealloc                        1586695 ops/s    630.2410 ns/op        -        481 runs  0.804 s
      ✔ 200 bytes - compress - snappyjs                                     298272.8 ops/s    3.352636 us/op        -        213 runs   1.22 s
      ✔ 200 bytes - compress - snappy                                       419528.0 ops/s    2.383631 us/op        -        926 runs   2.71 s
      ✔ 200 bytes - compress - snappy-wasm                                  472468.5 ops/s    2.116543 us/op        -        577 runs   1.72 s
      ✔ 200 bytes - compress - snappy-wasm - prealloc                        1430445 ops/s    699.0830 ns/op        -        868 runs   1.11 s
      ✔ 300 bytes - compress - snappyjs                                     265124.9 ops/s    3.771807 us/op        -        137 runs   1.02 s
      ✔ 300 bytes - compress - snappy                                       361683.9 ops/s    2.764845 us/op        -       1332 runs   4.18 s
      ✔ 300 bytes - compress - snappy-wasm                                  443688.4 ops/s    2.253834 us/op        -        859 runs   2.44 s
      ✔ 300 bytes - compress - snappy-wasm - prealloc                        1213825 ops/s    823.8420 ns/op        -        370 runs  0.807 s
      ✔ 400 bytes - compress - snappyjs                                     262168.5 ops/s    3.814341 us/op        -        358 runs   1.87 s
      ✔ 400 bytes - compress - snappy                                       382494.9 ops/s    2.614414 us/op        -       1562 runs   4.58 s
      ✔ 400 bytes - compress - snappy-wasm                                  406373.2 ops/s    2.460792 us/op        -        797 runs   2.46 s
      ✔ 400 bytes - compress - snappy-wasm - prealloc                        1111715 ops/s    899.5110 ns/op        -        450 runs  0.906 s
      ✔ 500 bytes - compress - snappyjs                                     229213.1 ops/s    4.362753 us/op        -        359 runs   2.07 s
      ✔ 500 bytes - compress - snappy                                       373695.8 ops/s    2.675973 us/op        -       2050 runs   5.99 s
      ✔ 500 bytes - compress - snappy-wasm                                  714917.4 ops/s    1.398763 us/op        -        960 runs   1.84 s
      ✔ 500 bytes - compress - snappy-wasm - prealloc                        1054619 ops/s    948.2100 ns/op        -        427 runs  0.907 s
      ✔ 1000 bytes - compress - snappyjs                                    148702.3 ops/s    6.724847 us/op        -        171 runs   1.65 s
      ✔ 1000 bytes - compress - snappy                                      423688.1 ops/s    2.360227 us/op        -        525 runs   1.74 s
      ✔ 1000 bytes - compress - snappy-wasm                                 524350.6 ops/s    1.907121 us/op        -        273 runs   1.03 s
      ✔ 1000 bytes - compress - snappy-wasm - prealloc                      685191.5 ops/s    1.459446 us/op        -        349 runs   1.01 s
      ✔ 10000 bytes - compress - snappyjs                                   21716.92 ops/s    46.04704 us/op        -         16 runs   1.24 s
      ✔ 10000 bytes - compress - snappy                                     98051.32 ops/s    10.19874 us/op        -        184 runs   2.39 s
      ✔ 10000 bytes - compress - snappy-wasm                                114681.8 ops/s    8.719783 us/op        -         49 runs  0.937 s
      ✔ 10000 bytes - compress - snappy-wasm - prealloc                     111203.6 ops/s    8.992518 us/op        -         49 runs  0.953 s
      ✔ 100000 bytes - compress - snappyjs                                  2947.313 ops/s    339.2921 us/op        -         12 runs   4.74 s
      ✔ 100000 bytes - compress - snappy                                    14963.78 ops/s    66.82801 us/op        -         70 runs   5.19 s
      ✔ 100000 bytes - compress - snappy-wasm                               19868.33 ops/s    50.33136 us/op        -         14 runs   1.21 s
      ✔ 100000 bytes - compress - snappy-wasm - prealloc                    24579.34 ops/s    40.68457 us/op        -         13 runs   1.06 s
    uncompress
      ✔ 100 bytes - uncompress - snappyjs                                   589201.6 ops/s    1.697212 us/op        -        242 runs  0.911 s
      ✔ 100 bytes - uncompress - snappy                                     537424.1 ops/s    1.860728 us/op        -        220 runs  0.910 s
      ✔ 100 bytes - uncompress - snappy-wasm                                634966.2 ops/s    1.574887 us/op        -        194 runs  0.808 s
      ✔ 100 bytes - uncompress - snappy-wasm - prealloc                      1846964 ops/s    541.4290 ns/op        -        559 runs  0.804 s
      ✔ 200 bytes - uncompress - snappyjs                                   395141.8 ops/s    2.530737 us/op        -        281 runs   1.22 s
      ✔ 200 bytes - uncompress - snappy                                     536862.6 ops/s    1.862674 us/op        -        274 runs   1.01 s
      ✔ 200 bytes - uncompress - snappy-wasm                                420251.6 ops/s    2.379527 us/op        -        129 runs  0.810 s
      ✔ 200 bytes - uncompress - snappy-wasm - prealloc                      1746167 ops/s    572.6830 ns/op        -        529 runs  0.804 s
      ✔ 300 bytes - uncompress - snappyjs                                   441676.2 ops/s    2.264102 us/op        -        898 runs   2.53 s
      ✔ 300 bytes - uncompress - snappy                                     551313.2 ops/s    1.813851 us/op        -        336 runs   1.11 s
      ✔ 300 bytes - uncompress - snappy-wasm                                494773.0 ops/s    2.021129 us/op        -        203 runs  0.912 s
      ✔ 300 bytes - uncompress - snappy-wasm - prealloc                      1528680 ops/s    654.1590 ns/op        -        465 runs  0.805 s
      ✔ 400 bytes - uncompress - snappyjs                                   383746.1 ops/s    2.605890 us/op        -        235 runs   1.11 s
      ✔ 400 bytes - uncompress - snappy                                     515986.6 ops/s    1.938035 us/op        -        158 runs  0.809 s
      ✔ 400 bytes - uncompress - snappy-wasm                                392947.8 ops/s    2.544867 us/op        -        322 runs   1.32 s
      ✔ 400 bytes - uncompress - snappy-wasm - prealloc                      1425978 ops/s    701.2730 ns/op        -        721 runs   1.01 s
      ✔ 500 bytes - uncompress - snappyjs                                   330727.5 ops/s    3.023637 us/op        -        173 runs   1.02 s
      ✔ 500 bytes - uncompress - snappy                                     513874.1 ops/s    1.946002 us/op        -        157 runs  0.806 s
      ✔ 500 bytes - uncompress - snappy-wasm                                389263.0 ops/s    2.568957 us/op        -        161 runs  0.914 s
      ✔ 500 bytes - uncompress - snappy-wasm - prealloc                      1330936 ops/s    751.3510 ns/op        -        672 runs   1.01 s
      ✔ 1000 bytes - uncompress - snappyjs                                  241393.9 ops/s    4.142606 us/op        -        126 runs   1.03 s
      ✔ 1000 bytes - uncompress - snappy                                    491119.6 ops/s    2.036164 us/op        -        201 runs  0.911 s
      ✔ 1000 bytes - uncompress - snappy-wasm                               361794.5 ops/s    2.764000 us/op        -        148 runs  0.910 s
      ✔ 1000 bytes - uncompress - snappy-wasm - prealloc                    959026.5 ops/s    1.042724 us/op        -        390 runs  0.909 s
      ✔ 10000 bytes - uncompress - snappyjs                                 40519.03 ops/s    24.67976 us/op        -         16 runs  0.913 s
      ✔ 10000 bytes - uncompress - snappy                                   202537.6 ops/s    4.937355 us/op        -        796 runs   4.43 s
      ✔ 10000 bytes - uncompress - snappy-wasm                              165017.6 ops/s    6.059960 us/op        -         52 runs  0.822 s
      ✔ 10000 bytes - uncompress - snappy-wasm - prealloc                   175061.5 ops/s    5.712277 us/op        -        130 runs   1.25 s
      ✔ 100000 bytes - uncompress - snappyjs                                4030.391 ops/s    248.1149 us/op        -         12 runs   3.71 s
      ✔ 100000 bytes - uncompress - snappy                                  35459.43 ops/s    28.20124 us/op        -         41 runs   1.67 s
      ✔ 100000 bytes - uncompress - snappy-wasm                             22449.16 ops/s    44.54509 us/op        -         13 runs   1.11 s
      ✔ 100000 bytes - uncompress - snappy-wasm - prealloc                  27169.50 ops/s    36.80598 us/op        -         13 runs  0.997 s

*/

describe("network / gossip / snappy", () => {
  const msgLens = [100, 200, 300, 400, 500, 1000, 10000, 100000];
  describe("compress", () => {
    const encoder = new snappyWasm.Encoder();

    for (const msgLen of msgLens) {
      const uncompressed = randomBytes(msgLen);
      const RUNS_FACTOR = 1000;

      itBench({
        id: `${msgLen} bytes - compress - snappyjs`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyjs.compress(uncompressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - compress - snappy`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappy.compressSync(uncompressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - compress - snappy-wasm`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            encoder.compress(uncompressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - compress - snappy-wasm - prealloc`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            let out = Buffer.allocUnsafe(snappyWasm.max_compress_len(uncompressed.length));
            const len = encoder.compress_into(uncompressed, out);
            out = out.subarray(0, len);
          }
        },
      });
    }
  });
  describe("uncompress", () => {
    const decoder = new snappyWasm.Decoder();

    for (const msgLen of msgLens) {
      const uncompressed = randomBytes(msgLen);
      const compressed = snappyjs.compress(uncompressed);
      const RUNS_FACTOR = 1000;

      itBench({
        id: `${msgLen} bytes - uncompress - snappyjs`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappyjs.uncompress(compressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - uncompress - snappy`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            snappy.uncompressSync(compressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - uncompress - snappy-wasm`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            decoder.decompress(compressed);
          }
        },
      });

      itBench({
        id: `${msgLen} bytes - uncompress - snappy-wasm - prealloc`,
        runsFactor: RUNS_FACTOR,
        fn: () => {
          for (let i = 0; i < RUNS_FACTOR; i++) {
            decoder.decompress_into(compressed, Buffer.allocUnsafe(snappyWasm.decompress_len(compressed)));
          }
        },
      });
    }
  });
});
