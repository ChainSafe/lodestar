import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {getFullDataColumnPublishOpts, shouldPublishPartialDataColumn} from "../../../src/network/dataColumnPublish.js";
import {GossipType} from "../../../src/network/gossip/interface.js";

function createTestConfig() {
  return createChainForkConfig({
    ...defaultChainConfig,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: Infinity,
  });
}

function createFuluSidecar() {
  const sidecar = ssz.fulu.DataColumnSidecar.defaultValue();
  sidecar.index = 1;
  sidecar.signedBlockHeader.message.slot = 1;
  return sidecar;
}

describe("data column publish helpers", () => {
  it("should exclude partial-capable peers from full-column gossip when partial columns are enabled", async () => {
    const config = createBeaconConfig(createTestConfig(), new Uint8Array(32));
    const core = {getPartialPeers: vi.fn(async () => ["peer-a", "peer-b"])};
    const sidecar = createFuluSidecar();

    const publishOpts = await getFullDataColumnPublishOpts(
      config,
      core,
      {type: GossipType.data_column_sidecar, boundary: config.getForkBoundaryAtEpoch(0), subnet: sidecar.index},
      sidecar,
      true
    );

    expect(core.getPartialPeers).toHaveBeenCalledOnce();
    expect(publishOpts).toEqual({excludePeerIds: ["peer-a", "peer-b"]});
  });

  it("should keep the legacy full-column gossip audience when partial columns are disabled", async () => {
    const config = createBeaconConfig(createTestConfig(), new Uint8Array(32));
    const core = {getPartialPeers: vi.fn(async () => ["peer-a"])};
    const sidecar = createFuluSidecar();

    const publishOpts = await getFullDataColumnPublishOpts(
      config,
      core,
      {type: GossipType.data_column_sidecar, boundary: config.getForkBoundaryAtEpoch(0), subnet: sidecar.index},
      sidecar,
      false
    );

    expect(core.getPartialPeers).not.toHaveBeenCalled();
    expect(publishOpts).toEqual({});
  });

  it("should only publish replacement partial messages when the caller allows it", () => {
    expect(shouldPublishPartialDataColumn(true, true)).toBe(true);
    expect(shouldPublishPartialDataColumn(true, false)).toBe(false);
    expect(shouldPublishPartialDataColumn(false, true)).toBe(false);
  });
});
