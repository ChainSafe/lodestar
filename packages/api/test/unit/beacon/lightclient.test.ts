import {describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {networksChainConfig} from "@lodestar/config/networks";
import {ForkName, SLOTS_PER_EPOCH, ZERO_HASH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getDefinitions} from "../../../src/beacon/routes/lightclient.js";

describe("lightclient updates SSZ fork digests", () => {
  it.each(["ephemery", "mainnet"] as const)("uses the runtime genesis root for %s", (network) => {
    const config = createBeaconConfig(
      {...networksChainConfig[network], FULU_FORK_EPOCH: 0},
      new Uint8Array(32).fill(1)
    );
    const codec = getDefinitions(config).getLightClientUpdatesByRange.resp.data;
    const updates = [0, 2048, 4096].map((epoch) => {
      const update = ssz.fulu.LightClientUpdate.defaultValue();
      update.attestedHeader.beacon.slot = epoch * SLOTS_PER_EPOCH;
      return update;
    });
    const bytes = codec.serialize(updates, {versions: updates.map(() => ForkName.fulu)});

    let offset = 0;
    for (const update of updates) {
      const epoch = update.attestedHeader.beacon.slot / SLOTS_PER_EPOCH;
      expect(Uint8Array.from(bytes.subarray(offset + 8, offset + 12)), `fork digest at epoch ${epoch}`).toEqual(
        config.forkBoundary2ForkDigest(config.getForkBoundaryAtEpoch(epoch))
      );
      offset += 8 + ssz.UintNum64.deserialize(bytes.subarray(offset, offset + 8));
    }
    expect(codec.deserialize(Uint8Array.from(bytes), {versions: updates.map(() => ForkName.fulu)})).toEqual(updates);
  });

  it("decodes updates serialized by a different node on the same ephemery iteration", () => {
    const chainConfig = networksChainConfig.ephemery;
    const root = new Uint8Array(32).fill(2);
    const senderConfig = createBeaconConfig(chainConfig, root);
    const receiverConfig = createBeaconConfig(chainConfig, root);
    const update = ssz.fulu.LightClientUpdate.defaultValue();
    const meta = {versions: [ForkName.fulu]};
    const serialized = ssz.fulu.LightClientUpdate.serialize(update);
    const bytes = Buffer.concat([
      ssz.UintNum64.serialize(4 + serialized.length),
      senderConfig.forkBoundary2ForkDigest(senderConfig.getForkBoundaryAtEpoch(0)),
      serialized,
    ]);

    expect(
      getDefinitions(receiverConfig).getLightClientUpdatesByRange.resp.data.deserialize(Uint8Array.from(bytes), meta)
    ).toEqual([update]);
    const previousConfig = createBeaconConfig(chainConfig, new Uint8Array(32).fill(3));
    expect(() =>
      getDefinitions(previousConfig).getLightClientUpdatesByRange.resp.data.deserialize(bytes, meta)
    ).toThrow();
  });

  it("retains the zero-root fallback for a custom chain without runtime genesis", () => {
    const chainConfig = {...networksChainConfig.ephemery, CONFIG_NAME: "custom"};
    const config = createChainForkConfig(chainConfig);
    const codec = getDefinitions(config).getLightClientUpdatesByRange.resp.data;
    const update = ssz.fulu.LightClientUpdate.defaultValue();
    const meta = {versions: [ForkName.fulu]};
    const bytes = codec.serialize([update], meta);
    const expectedConfig = createBeaconConfig(chainConfig, ZERO_HASH);

    expect(Uint8Array.from(bytes.subarray(8, 12))).toEqual(
      expectedConfig.forkBoundary2ForkDigest(expectedConfig.getForkBoundaryAtEpoch(0))
    );
    expect(codec.deserialize(Uint8Array.from(bytes), meta)).toEqual([update]);
  });
});
