import {describe, expect, it} from "vitest";
import {SecretKey, Signature, verify} from "@chainsafe/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {getExecutionPayloadBidSigningRoot, getExecutionPayloadEnvelopeSigningRoot} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {BuilderSigner} from "../../../src/services/builderSigner.js";

describe("BuilderSigner", () => {
  const chainConfig = getConfig(ForkName.gloas);
  const genesisValidatorsRoot = Buffer.alloc(32, 9);
  const beaconConfig = createBeaconConfig(chainConfig, genesisValidatorsRoot);

  const secretKey = SecretKey.fromBytes(Buffer.alloc(32, 1));
  const publicKey = secretKey.toPublicKey();

  const builderSigner = new BuilderSigner(beaconConfig, {publicKey, secretKey});

  it("verify signed payload envelope", () => {
    const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();

    const signedEnvelope = builderSigner.signExecutionPayloadEnvelope(envelope);

    expect(
      verify(
        getExecutionPayloadEnvelopeSigningRoot(beaconConfig, envelope),
        publicKey,
        Signature.fromBytes(signedEnvelope.signature, true)
      )
    ).toEqual(true);
  });

  it("verify signed bid", () => {
    const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
    bid.slot = 1;

    const signedBid = builderSigner.signExecutionPayloadBid(bid);

    expect(
      verify(
        getExecutionPayloadBidSigningRoot(beaconConfig, bid),
        publicKey,
        Signature.fromBytes(signedBid.signature, true)
      )
    ).toEqual(true);
  });

  describe("negative tests - different network", () => {
    const genesisValidatorsRootOtherNetwork = Buffer.alloc(32, 8);
    const beaconConfigOtherNetwork = createBeaconConfig(chainConfig, genesisValidatorsRootOtherNetwork);

    it("does not verify envelope under a different network", () => {
      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();

      const signedEnvelope = builderSigner.signExecutionPayloadEnvelope(envelope);

      expect(
        verify(
          getExecutionPayloadEnvelopeSigningRoot(beaconConfigOtherNetwork, envelope),
          publicKey,
          Signature.fromBytes(signedEnvelope.signature, true)
        )
      ).toEqual(false);
    });

    it("does not verify bid under a different network", () => {
      const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
      bid.slot = 1;

      const signedBid = builderSigner.signExecutionPayloadBid(bid);

      expect(
        verify(
          getExecutionPayloadBidSigningRoot(beaconConfigOtherNetwork, bid),
          publicKey,
          Signature.fromBytes(signedBid.signature, true)
        )
      ).toEqual(false);
    });
  });

  describe("negative tests - different fork", () => {
    const chainConfigOtherFork = getConfig(ForkName.gloas, 100);
    const beaconConfigOtherFork = createBeaconConfig(chainConfigOtherFork, genesisValidatorsRoot);

    it("does not verify envelope under a different fork", () => {
      const envelope = ssz.gloas.ExecutionPayloadEnvelope.defaultValue();

      const signedEnvelope = builderSigner.signExecutionPayloadEnvelope(envelope);

      expect(
        verify(
          getExecutionPayloadEnvelopeSigningRoot(beaconConfigOtherFork, envelope),
          publicKey,
          Signature.fromBytes(signedEnvelope.signature, true)
        )
      ).toEqual(false);
    });

    it("does not verify bid under a different fork", () => {
      const bid = ssz.gloas.ExecutionPayloadBid.defaultValue();
      bid.slot = 1;

      const signedBid = builderSigner.signExecutionPayloadBid(bid);

      expect(
        verify(
          getExecutionPayloadBidSigningRoot(beaconConfigOtherFork, bid),
          publicKey,
          Signature.fromBytes(signedBid.signature, true)
        )
      ).toEqual(false);
    });
  });
});
