import {itBench} from "@dapplion/benchmark";

describe("bytes utils", function () {
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
});
