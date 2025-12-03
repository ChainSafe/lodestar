import {beforeAll, bench, describe} from "@chainsafe/benchmark";

/**
 * Enable this if you want to compare performance of Buffer vs Uint8Array operations. Not lodestar code so skipped by default.
 */
describe.skip("bytes utils", () => {
  const roots: Uint8Array[] = [];
  let buffers: Buffer[] = [];
  const count = 32;

  beforeAll(() => {
    for (let i = 0; i < count; i++) {
      roots.push(new Uint8Array(Array.from({length: 32}, () => i)));
    }
    buffers = roots.map((root) => Buffer.from(root.buffer));
  }, 60 * 1000);

  bench({
    id: `Buffer.concat ${count} items`,
    fn: () => {
      Buffer.concat(buffers);
    },
  });

  bench({
    id: `Uint8Array.set ${count} items`,
    fn: () => {
      let size = 0;
      for (const b of buffers) {
        size += b.length;
      }
      const arr = new Uint8Array(size);
      let offset = 0;
      for (const b of buffers) {
        arr.set(b, offset);
        offset += b.length;
      }
    },
  });

  bench({
    id: "Buffer.copy",
    fn: () => {
      const arr = Buffer.alloc(32 * count);
      let offset = 0;
      for (const b of buffers) {
        b.copy(arr, offset, 0, b.length);
        offset += b.length;
      }
    },
  });

  bench({
    id: "Uint8Array.set - with subarray",
    fn: () => {
      const arr = new Uint8Array(32 * count);
      let offset = 0;
      for (const b of roots) {
        arr.set(b.subarray(0, b.length), offset);
        offset += b.length;
      }
    },
  });

  bench({
    id: "Uint8Array.set - without subarray",
    fn: () => {
      const arr = new Uint8Array(32 * count);
      let offset = 0;
      for (const b of roots) {
        arr.set(b, offset);
        offset += b.length;
      }
    },
  });
});
