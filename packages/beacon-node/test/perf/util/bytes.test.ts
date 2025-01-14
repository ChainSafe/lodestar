import {itBench} from "@dapplion/benchmark";

describe("bytes utils", () => {
  const roots: Uint8Array[] = [];
  let buffers: Buffer[] = [];
  const count = 32;
  before(function () {
    this.timeout(60 * 1000);
    for (let i = 0; i < count; i++) {
      roots.push(new Uint8Array(Array.from({length: 32}, () => i)));
    }
    buffers = roots.map((root) => Buffer.from(root.buffer));
  });

  itBench({
    id: `Buffer.concat ${count} items`,
    fn: () => {
      Buffer.concat(buffers);
    },
  });

  itBench({
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

  itBench({
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

  itBench({
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

  itBench({
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
