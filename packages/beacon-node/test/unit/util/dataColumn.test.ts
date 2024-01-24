import {describe, it, expect} from "vitest";
import {ssz} from "@lodestar/types";

import {getCustodyColumns} from "../../../src/util/dataColumns.js";

describe("custody columns", () => {
  it("getCustodyColumnIndexes", async () => {
    const nodeId = ssz.UintBn256.serialize(
      BigInt("84065159290331321853352677657753050104170032838956724170714636178275273565505")
    );
    const columnIndexs = getCustodyColumns(nodeId, 1);
    expect(columnIndexs).toEqual([27, 59, 91, 123]);
  });
});
