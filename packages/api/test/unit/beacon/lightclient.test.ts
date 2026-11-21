import {describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getDefinitions} from "../../../src/beacon/routes/lightclient.js";

describe("beacon / lightclient / getLightClientUpdatesByRange", () => {
  const chainConfig = createChainForkConfig({
    ...defaultChainConfig,
    CONFIG_NAME: "custom",
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: Infinity,
    GLOAS_FORK_EPOCH: Infinity,
    HEZE_FORK_EPOCH: Infinity,
    BLOB_SCHEDULE: [],
  });
  const beaconConfig = createBeaconConfig(chainConfig, new Uint8Array(32).fill(1));
  const updates = [ssz.electra.LightClientUpdate.defaultValue()];
  const meta = {versions: [ForkName.electra]};
  const bytes = Uint8Array.from(
    getDefinitions(beaconConfig).getLightClientUpdatesByRange.resp.data.serialize(updates, meta)
  );

  it("serializes fork digests with the runtime genesis validators root", () => {
    expect(bytes.subarray(8, 12)).toEqual(beaconConfig.forkBoundary2ForkDigest(beaconConfig.getForkBoundaryAtEpoch(0)));
  });

  it("deserializes with a chain config from version metadata", () => {
    expect(getDefinitions(chainConfig).getLightClientUpdatesByRange.resp.data.deserialize(bytes, meta)).toEqual(
      updates
    );
  });
});
