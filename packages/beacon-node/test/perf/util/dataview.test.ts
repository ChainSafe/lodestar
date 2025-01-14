import {itBench} from "@dapplion/benchmark";

describe("dataview", () => {
  const data = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

  itBench({
    id: "getUint32 - dataview",
    beforeEach: () => {
      return 0;
    },
    fn: (offset) => {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      view.getUint32(offset, true);
    },
  });

  itBench({
    id: "getUint32 - manual",
    beforeEach: () => {
      return 0;
    },
    fn: (offset) => {
      // check high bytes for non-zero values
      (data[offset + 4] | data[offset + 5] | data[offset + 6] | data[offset + 7]) === 0;
      // create the uint32
      (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
    },
  });
});
