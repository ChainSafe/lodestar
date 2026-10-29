import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {ForkName, NUMBER_OF_COLUMNS, ZERO_HASH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataColumnSidecarsByRange, DataColumnSidecarsByRoot} from "../../../../src/network/reqresp/protocols.js";
import {computeMaxGloasDataColumnSidecarSize} from "../../../../src/util/sszBytes.js";
import {DataColumnSidecarsByRootRequestType} from "../../../../src/util/types.js";

describe("network / reqresp / protocols", () => {
  const config = createBeaconConfig({...chainConfig, GLOAS_FORK_EPOCH: 700000}, ZERO_HASH);

  it("allows batched column requests larger than one sidecar", () => {
    const requestType = DataColumnSidecarsByRootRequestType(config);
    const request = Array.from({length: 42}, (_, index) => ({
      blockRoot: new Uint8Array(32).fill(index),
      columns: Array.from({length: NUMBER_OF_COLUMNS}, (_, column) => column),
    }));
    const serialized = requestType.serialize(request);
    const {requestSizes} = DataColumnSidecarsByRoot(ForkName.gloas, config);

    expect(request.length).toBeLessThanOrEqual(config.MAX_REQUEST_BLOCKS_DENEB);
    expect(request.length * NUMBER_OF_COLUMNS).toBeLessThanOrEqual(config.MAX_REQUEST_DATA_COLUMN_SIDECARS);
    expect(serialized.length).toBeGreaterThan(computeMaxGloasDataColumnSidecarSize(config));
    expect(requestSizes?.maxSize).toBeGreaterThanOrEqual(serialized.length);
  });

  for (const protocol of [DataColumnSidecarsByRange, DataColumnSidecarsByRoot]) {
    const {method, responseSizes} = protocol(ForkName.gloas, config);

    it.each([ForkName.gloas, ForkName.heze])(`bounds ${method} responses in %s by the blob schedule`, (fork) => {
      expect(responseSizes(fork).maxSize).toBe(computeMaxGloasDataColumnSidecarSize(config));
    });

    it(`preserves the Fulu response limit for ${method} after Gloas`, () => {
      expect(responseSizes(ForkName.fulu).maxSize).toBe(
        Math.min(ssz.fulu.DataColumnSidecar.maxSize, config.MAX_PAYLOAD_SIZE)
      );
    });

    it(`respects MAX_PAYLOAD_SIZE for ${method} responses`, () => {
      const smallPayloadConfig = createBeaconConfig({...chainConfig, MAX_PAYLOAD_SIZE: 32_000}, ZERO_HASH);
      const {responseSizes} = protocol(ForkName.gloas, smallPayloadConfig);

      expect(responseSizes(ForkName.gloas).maxSize).toBe(smallPayloadConfig.MAX_PAYLOAD_SIZE);
    });
  }
});
