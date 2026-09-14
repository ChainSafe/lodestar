import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {ForkName, ZERO_HASH} from "@lodestar/params";
import {DataColumnSidecarsByRange, DataColumnSidecarsByRoot} from "../../../../src/network/reqresp/protocols.js";
import {computeMaxGloasDataColumnSidecarSize} from "../../../../src/util/sszBytes.js";

describe("network / reqresp / protocols", () => {
  const config = createBeaconConfig({...chainConfig, GLOAS_FORK_EPOCH: 700000}, ZERO_HASH);

  it("bounds DataColumnSidecars response size by the blob-schedule-derived size post-fulu (consensus-specs #5613)", () => {
    const maxCol = computeMaxGloasDataColumnSidecarSize(config);
    // sanity: below the 4096-cell SSZ type max, so the clamp (min of the two) resolves to the computed bound
    expect(maxCol).toBeLessThan(8_585_272);

    for (const protocol of [DataColumnSidecarsByRange, DataColumnSidecarsByRoot]) {
      const {responseSizes} = protocol(ForkName.gloas, config);
      expect(responseSizes(ForkName.gloas).maxSize).toBe(maxCol);
    }
  });
});
