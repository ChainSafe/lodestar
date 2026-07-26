import {SecretKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {getExecutionPayloadBidSigningRoot, getExecutionPayloadEnvelopeSigningRoot} from "@lodestar/state-transition";
import {BLSPubkey, gloas} from "@lodestar/types";

type Signer = {
  publicKey: BLSPubkey;
  secretKey: SecretKey;
};

export class BuilderSigner {
  private readonly config: BeaconConfig;
  private readonly signer: Signer;

  constructor(config: BeaconConfig, signerSecretKey: SecretKey) {
    this.config = config;
    this.signer = {
      publicKey: signerSecretKey.toPublicKey().toBytes(),
      secretKey: signerSecretKey,
    };
  }

  signExecutionPayloadEnvelope(envelope: gloas.ExecutionPayloadEnvelope): gloas.SignedExecutionPayloadEnvelope {
    const signingRoot = getExecutionPayloadEnvelopeSigningRoot(this.config, envelope);

    return {
      message: envelope,
      signature: this.signer.secretKey.sign(signingRoot).toBytes(),
    };
  }

  signExecutionPayloadBid(bid: gloas.ExecutionPayloadBid): gloas.SignedExecutionPayloadBid {
    const signingRoot = getExecutionPayloadBidSigningRoot(this.config, bid.slot, bid);

    return {
      message: bid,
      signature: this.signer.secretKey.sign(signingRoot).toBytes(),
    };
  }

  getPubkey(): BLSPubkey {
    return this.signer.publicKey;
  }
}
