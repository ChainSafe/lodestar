import {ssz} from "@lodestar/types";
import {describe, expect, it} from "vitest";
import {byteArrayEquals} from "../../../src/util/bytes.js";
import {
  buildCustodyIndex,
  calculateDataColumnByteLength,
  dataColumnSidecarsDbWrapperSsz,
  parseWrappedColumnSidecars,
} from "../../../src/util/dataColumns.js";
import {generateColumnSidecars} from "../../utils/blocksAndData.js";

describe("src/util/dataColumns.ts", () => {
  const numberOfBlobs = 6;
  const sidecars = generateColumnSidecars(numberOfBlobs);
  const custodyIndices = [2, 4, 6, 8, 10];
  const dataColumnSidecars = sidecars.filter((_, index) => custodyIndices.includes(index));
  const blockRoot = ssz.fulu.BeaconBlockHeader.hashTreeRoot(dataColumnSidecars[0].signedBlockHeader.message);

  const wrapped = dataColumnSidecarsDbWrapperSsz.defaultValue();
  wrapped.blockRoot = blockRoot;
  wrapped.slot = dataColumnSidecars[0].signedBlockHeader.message.slot;
  wrapped.dataColumnSidecars = sidecars.filter((_, index) => custodyIndices.includes(index));
  wrapped.dataColumnsIndex = buildCustodyIndex(custodyIndices);
  wrapped.dataColumnsLen = wrapped.dataColumnSidecars.length;
  wrapped.dataColumnsSize = calculateDataColumnByteLength(numberOfBlobs);

  describe("parseWrappedColumnSidecars", () => {
    const {custodyIndex, columnSizeInBytes, numberOfColumns, serializedColumnSidecars} = parseWrappedColumnSidecars(
      dataColumnSidecarsDbWrapperSsz.serialize(wrapped)
    );
    it("should correctly deserialize custodyIndex", () => {
      expect(custodyIndex).toEqual(wrapped.dataColumnsIndex);
    });
    it("should correctly deserialize columnSizeInBytes", () => {
      expect(columnSizeInBytes).toEqual(wrapped.dataColumnsSize);
    });
    it("should correctly deserialize numberOfColumns", () => {
      expect(numberOfColumns).toEqual(wrapped.dataColumnsLen);
    });
    it("should correctly deserialize serializedColumnSidecars", () => {
      expect(
        byteArrayEquals(
          serializedColumnSidecars,
          Buffer.concat(dataColumnSidecars.map((sidecar) => ssz.fulu.DataColumnSidecar.serialize(sidecar)))
        )
      ).toBeTruthy();
    });
  });
});
