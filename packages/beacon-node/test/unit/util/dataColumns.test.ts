import {randomBytes} from "node:crypto";
import {ssz} from "@lodestar/types/lib";
import {describe, expect, it} from "vitest";
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

  it("parseWrappedColumnSidecars", () => {
    const {custodyIndex, columnSizeInBytes, numberOfColumns, serializedColumnSidecars} = parseWrappedColumnSidecars(
      dataColumnSidecarsDbWrapperSsz.serialize(wrapped)
    );
    expect(custodyIndex).toEqual(wrapped.dataColumnsIndex);
    expect(columnSizeInBytes).toEqual(wrapped.dataColumnsSize);
    expect(numberOfColumns).toEqual(wrapped.dataColumnsLen);
    expect(serializedColumnSidecars).toEqual(
      Buffer.concat(dataColumnSidecars.map(ssz.fulu.DataColumnSidecar.serialize))
    );
  });
});
