import { SecretKey } from "@chainsafe/blst";
import { BeaconConfig } from "@lodestar/config";
import { BLSPubkey, gloas } from "@lodestar/types";
import {getExecutionPayloadBidSigningRoot} from "@lodestar/state-transition";


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
    }
  }

  signExecutionPayloadBid(
    bid: gloas.ExecutionPayloadBid
  ): gloas.SignedExecutionPayloadBid {
    const signingRoot = getExecutionPayloadBidSigningRoot(this.config, bid.slot, bid);

    return {
      message: bid,
      signature: this.signer.secretKey.sign(signingRoot).toBytes(),
    };
  }

  getPubKey(): BLSPubkey {
    return this.signer.publicKey;
  }
}
