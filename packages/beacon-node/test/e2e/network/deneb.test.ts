import {expect} from "chai";
import {deneb, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {signedBeaconBlockAndBlobsSidecarFromBytes} from "../../../src/network/reqresp/handlers/beaconBlockAndBlobsSidecarByRoot.js";

describe("signedBeaconBlockAndBlobsSidecarFromBytes", () => {
  it("signedBeaconBlockAndBlobsSidecarFromBytes", () => {
    const beaconBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
    const blobsSidecar = ssz.deneb.BlobsSidecar.defaultValue();

    const signedBeaconBlockAndBlobsSidecarBytes = signedBeaconBlockAndBlobsSidecarFromBytes(
      ssz.deneb.SignedBeaconBlock.serialize(beaconBlock),
      ssz.deneb.BlobsSidecar.serialize(blobsSidecar)
    );

    const signedBeaconBlockAndBlobsSidecar: deneb.SignedBeaconBlockAndBlobsSidecar = {
      beaconBlock,
      blobsSidecar,
    };

    expect(toHex(signedBeaconBlockAndBlobsSidecarBytes)).equals(
      toHex(ssz.deneb.SignedBeaconBlockAndBlobsSidecar.serialize(signedBeaconBlockAndBlobsSidecar)),
      "Wrong signedBeaconBlockAndBlobsSidecarBytes"
    );

    // Ensure deserialize does not throw
    ssz.deneb.SignedBeaconBlockAndBlobsSidecar.deserialize(signedBeaconBlockAndBlobsSidecarBytes);
  });
});
