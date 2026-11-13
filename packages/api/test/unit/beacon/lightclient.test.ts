import {describe, expect, it} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {networksChainConfig} from "@lodestar/config/networks";
import {ForkName, SLOTS_PER_EPOCH, ZERO_HASH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {getDefinitions} from "../../../src/beacon/routes/lightclient.js";
import {HeadersExtra} from "../../../src/utils/headers.js";
import {MetaHeader} from "../../../src/utils/metadata.js";

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
    expect(
      getDefinitions(receiverConfig).getLightClientUpdatesByRange.resp.data.deserialize(Uint8Array.from(bytes), {
        versions: [],
      })
    ).toEqual([update]);
    const previousConfig = createBeaconConfig(chainConfig, new Uint8Array(32).fill(3));
    expect(() =>
      getDefinitions(previousConfig).getLightClientUpdatesByRange.resp.data.deserialize(bytes, {versions: []})
    ).toThrow("Unknown forkDigest");
  });

  it.each(["ephemery", "custom"] as const)("decodes mixed-fork updates without the genesis root on %s", (network) => {
    const chainConfig = createChainForkConfig({
      ...networksChainConfig.ephemery,
      CONFIG_NAME: network,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 1,
      DENEB_FORK_EPOCH: 2,
      ELECTRA_FORK_EPOCH: 3,
      FULU_FORK_EPOCH: 4,
    });
    const serverConfig = createBeaconConfig(chainConfig, new Uint8Array(32).fill(4));
    const versions = [ForkName.bellatrix, ForkName.capella, ForkName.deneb, ForkName.electra, ForkName.fulu] as const;
    const meta = {versions: [...versions]};
    const updates = versions.map((version, i) => {
      const update = ssz[version].LightClientUpdate.defaultValue();
      update.attestedHeader.beacon.slot = i * SLOTS_PER_EPOCH;
      return update;
    });
    const bytes = getDefinitions(serverConfig).getLightClientUpdatesByRange.resp.data.serialize(updates, meta);
    const clientCodec = getDefinitions(chainConfig).getLightClientUpdatesByRange.resp.data;

    expect(clientCodec.deserialize(Uint8Array.from(bytes), meta)).toEqual(updates);
    expect(() => clientCodec.deserialize(Uint8Array.from(bytes), {versions: []})).toThrow("Unknown forkDigest");
  });

  it.each([{versions: []}, {versions: [ForkName.fulu]}])(
    "uses fork digests for missing version entries ($versions)",
    ({versions}) => {
      const config = createBeaconConfig(
        {...networksChainConfig.ephemery, FULU_FORK_EPOCH: 0},
        new Uint8Array(32).fill(5)
      );
      const codec = getDefinitions(config).getLightClientUpdatesByRange.resp.data;
      const updates = [0, 2048, 4096].map((epoch) => {
        const update = ssz.fulu.LightClientUpdate.defaultValue();
        update.attestedHeader.beacon.slot = epoch * SLOTS_PER_EPOCH;
        return update;
      });
      const bytes = codec.serialize(updates, {versions: updates.map(() => ForkName.fulu)});

      expect(codec.deserialize(Uint8Array.from(bytes), {versions})).toEqual(updates);
    }
  );

  it("rejects version metadata that does not support light client updates", () => {
    const config = createBeaconConfig(networksChainConfig.ephemery, new Uint8Array(32).fill(6));
    const codec = getDefinitions(config).getLightClientUpdatesByRange.resp.data;
    const update = ssz.fulu.LightClientUpdate.defaultValue();
    const bytes = codec.serialize([update], {versions: [ForkName.fulu]});

    expect(() => codec.deserialize(Uint8Array.from(bytes), {versions: [ForkName.phase0]})).toThrow(
      "Invalid fork=phase0 for post-altair fork types"
    );
  });

  it("normalizes version headers before decoding without the genesis root", () => {
    const chainConfig = createChainForkConfig(networksChainConfig.ephemery);
    const serverConfig = createBeaconConfig(chainConfig, new Uint8Array(32).fill(8));
    const updates = [ssz.fulu.LightClientUpdate.defaultValue(), ssz.fulu.LightClientUpdate.defaultValue()];
    const meta = {versions: [ForkName.fulu, ForkName.fulu]};
    const bytes = getDefinitions(serverConfig).getLightClientUpdatesByRange.resp.data.serialize(updates, meta);
    const response = getDefinitions(chainConfig).getLightClientUpdatesByRange.resp;
    const parsedMeta = response.meta.fromHeaders(new HeadersExtra({[MetaHeader.Version]: "FULU, FULU"}));

    expect(parsedMeta).toEqual(meta);
    expect(response.data.deserialize(Uint8Array.from(bytes), parsedMeta)).toEqual(updates);
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
