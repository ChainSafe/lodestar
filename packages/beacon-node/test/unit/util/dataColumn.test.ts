import {describe, it, expect} from "vitest";
import {fromHexString} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";

import {getCustodyColumns} from "../../../src/util/dataColumns.js";

describe("custody columns", () => {
  const testCases = [
    ["cdbee32dc3c50e9711d22be5565c7e44ff6108af663b2dc5abd2df573d2fa83f", 4, [0, 2, 4, 107]],
    [
      "51781405571328938149219259614021022118347017557305093857689627172914154745642",
      47,
      [
        3, 6, 7, 8, 9, 12, 25, 26, 29, 30, 32, 40, 42, 47, 52, 53, 54, 55, 56, 57, 69, 70, 71, 72, 74, 77, 80, 81, 83,
        88, 93, 94, 95, 98, 101, 105, 106, 112, 114, 116, 118, 120, 121, 123, 124, 125, 127,
      ],
    ],
    ["84065159290331321853352677657753050104170032838956724170714636178275273565505", 6, [27, 29, 58, 67, 96, 117]],
  ];
  for (const [nodeIdHex, numSubnets, custodyColumns] of testCases) {
    it(`${nodeIdHex} / ${numSubnets}`, async () => {
      const nodeId = nodeIdHex.length === 64 ? fromHexString(nodeIdHex) : ssz.UintBn256.serialize(BigInt(nodeIdHex));
      const columnIndexs = getCustodyColumns(nodeId, numSubnets);
      expect(columnIndexs).toEqual(custodyColumns);
    });
  }
});
