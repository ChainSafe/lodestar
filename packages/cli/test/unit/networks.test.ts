import {describe, expect, it} from "vitest";
import {ENR} from "@chainsafe/enr";
import {getGenesisFileUrl, getGenesisStateRoot, getNetworkData, isKnownNetworkName} from "../../src/networks/index.js";

describe("plataberget network", () => {
  it("is a known network with genesis and bootnode data", () => {
    expect(isKnownNetworkName("plataberget")).toBe(true);
    expect(getGenesisFileUrl("plataberget")).toBe(
      "https://raw.githubusercontent.com/ethpandaops/glamsterdam-devnets/master/network-configs/devnet-8/metadata/genesis.ssz"
    );
    expect(getGenesisStateRoot("plataberget")).toBe(
      "0x328f399d20b80bb5cdc1f325ccc160bae63d81c8fa9b23fcf8c1795f40d8df9d"
    );

    const {bootEnrs, bootnodesFileUrl} = getNetworkData("plataberget");
    expect(bootnodesFileUrl).toBe(
      "https://raw.githubusercontent.com/ethpandaops/glamsterdam-devnets/master/network-configs/devnet-8/metadata/bootstrap_nodes.yaml"
    );
    expect(bootEnrs).toHaveLength(20);
    for (const enr of bootEnrs) {
      expect(() => ENR.decodeTxt(enr)).not.toThrow();
    }
  });
});
