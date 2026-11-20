import {BeaconConfig} from "@lodestar/config";
import {PublicKey, SecretKey} from "@lodestar/native/blst";
import {getExecutionPayloadBidSigningRoot, getExecutionPayloadEnvelopeSigningRoot} from "@lodestar/state-transition";
import {gloas, heze} from "@lodestar/types";

export type Keypair = {publicKey: PublicKey; secretKey: SecretKey};

export class BuilderSigner {
  private readonly config: BeaconConfig;
  private readonly keypair: Keypair;

  constructor(
    config: BeaconConfig,
    keypair: Keypair,
    private readonly assertCanSign?: () => void
  ) {
    this.config = config;
    this.keypair = keypair;
  }

  signExecutionPayloadEnvelope(envelope: gloas.ExecutionPayloadEnvelope): gloas.SignedExecutionPayloadEnvelope {
    this.assertCanSign?.();
    const signingRoot = getExecutionPayloadEnvelopeSigningRoot(this.config, envelope);

    return {
      message: envelope,
      signature: this.keypair.secretKey.sign(signingRoot).toBytes(),
    };
  }

  signExecutionPayloadBid(bid: heze.ExecutionPayloadBid): heze.SignedExecutionPayloadBid;
  signExecutionPayloadBid(bid: gloas.ExecutionPayloadBid): gloas.SignedExecutionPayloadBid;
  signExecutionPayloadBid(bid: gloas.ExecutionPayloadBid): gloas.SignedExecutionPayloadBid {
    this.assertCanSign?.();
    const signingRoot = getExecutionPayloadBidSigningRoot(this.config, bid);

    return {
      message: bid,
      signature: this.keypair.secretKey.sign(signingRoot).toBytes(),
    };
  }

  getPubkeyHex(): string {
    return this.keypair.publicKey.toHex();
  }
}
