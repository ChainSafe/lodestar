import {expect} from "chai";
import {eip4844, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {signedBeaconBlockAndBlobsSidecarFromBytes} from "../../../src/network/reqresp/handlers/beaconBlockAndBlobsSidecarByRoot.js";

describe("signedBeaconBlockAndBlobsSidecarFromBytes", () => {
  it("signedBeaconBlockAndBlobsSidecarFromBytes", () => {
    const beaconBlock = ssz.eip4844.SignedBeaconBlock.defaultValue();
    const blobsSidecar = ssz.eip4844.BlobsSidecar.defaultValue();

    const signedBeaconBlockAndBlobsSidecarBytes = signedBeaconBlockAndBlobsSidecarFromBytes(
      ssz.eip4844.SignedBeaconBlock.serialize(beaconBlock),
      ssz.eip4844.BlobsSidecar.serialize(blobsSidecar)
    );

    const signedBeaconBlockAndBlobsSidecar: eip4844.SignedBeaconBlockAndBlobsSidecar = {
      beaconBlock,
      blobsSidecar,
    };

    expect(toHex(signedBeaconBlockAndBlobsSidecarBytes)).equals(
      toHex(ssz.eip4844.SignedBeaconBlockAndBlobsSidecar.serialize(signedBeaconBlockAndBlobsSidecar)),
      "Wrong signedBeaconBlockAndBlobsSidecarBytes"
    );

    // Ensure deserialize does not throw
    ssz.eip4844.SignedBeaconBlockAndBlobsSidecar.deserialize(signedBeaconBlockAndBlobsSidecarBytes);
  });
});
