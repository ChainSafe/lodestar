import {PublicKey, SecretKey} from "@chainsafe/blst";
import {BeaconConfig} from "@lodestar/config";
import {getExecutionPayloadBidSigningRoot, getExecutionPayloadEnvelopeSigningRoot} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";

export type Keypair = {publicKey: PublicKey; secretKey: SecretKey};

export class BuilderSigner {
  private readonly config: BeaconConfig;
  private readonly keypair: Keypair;

  constructor(config: BeaconConfig, keypair: Keypair) {
    this.config = config;
    this.keypair = keypair;
  }

  signExecutionPayloadEnvelope(envelope: gloas.ExecutionPayloadEnvelope): gloas.SignedExecutionPayloadEnvelope {
    const signingRoot = getExecutionPayloadEnvelopeSigningRoot(this.config, envelope);

    return {
      message: envelope,
      signature: this.keypair.secretKey.sign(signingRoot).toBytes(),
    };
  }

  signExecutionPayloadBid(bid: gloas.ExecutionPayloadBid): gloas.SignedExecutionPayloadBid {
    const signingRoot = getExecutionPayloadBidSigningRoot(this.config, bid.slot, bid);

    return {
      message: bid,
      signature: this.keypair.secretKey.sign(signingRoot).toBytes(),
    };
  }

  getPubkeyHex(): string {
    return this.keypair.publicKey.toHex();
  }
}
