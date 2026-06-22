import {describe, expect, it} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {serializeSignedBlockForNative} from "../../src/stateTransition.js";

describe("stateTransition", () => {
  describe("serializeSignedBlockForNative", () => {
    it("serializes blinded blocks with SignedBlindedBeaconBlock", () => {
      const config = getConfig(ForkName.bellatrix);
      const signedBlock = ssz.bellatrix.SignedBlindedBeaconBlock.defaultValue();

      expect(serializeSignedBlockForNative(config, signedBlock)).toEqual(
        ssz.bellatrix.SignedBlindedBeaconBlock.serialize(signedBlock)
      );
    });

    it("serializes full blocks with SignedBeaconBlock", () => {
      const config = getConfig(ForkName.bellatrix);
      const signedBlock = ssz.bellatrix.SignedBeaconBlock.defaultValue();

      expect(serializeSignedBlockForNative(config, signedBlock)).toEqual(
        ssz.bellatrix.SignedBeaconBlock.serialize(signedBlock)
      );
    });
  });
});
