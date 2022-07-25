import {itBench} from "@dapplion/benchmark";
import {byteArrayConcat} from "../../../src/util/bytes.js";

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
    id: `byteArrayConcat ${count} items`,
    fn: () => {
      byteArrayConcat(roots);
    },
    runsFactor: 1000,
  });

  itBench({
    id: `Buffer.concat ${count} items`,
    fn: () => {
      Buffer.concat(buffers);
    },
    runsFactor: 1000,
  });
});
