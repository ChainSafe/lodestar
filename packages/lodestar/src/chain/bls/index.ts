import {bls, PublicKey} from "@chainsafe/bls";
import {ISignatureSet, SignatureSetType} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BlsMultiThreadNaive} from "./multithread";

export interface IBlsVerifier {
  verifySignatureSetsBatch(signatureSets: ISignatureSet[]): Promise<boolean>;
}

export class BlsVerifier implements IBlsVerifier {
  private readonly pool: BlsMultiThreadNaive;
  constructor(logger: ILogger) {
    this.pool = new BlsMultiThreadNaive(logger, bls.implementation);
  }

  verifySignatureSetsBatch(signatureSets: ISignatureSet[]): Promise<boolean> {
    // Signatures all come from the wire (untrusted) are all bytes compressed, must be:
    // - Parsed from bytes
    // - Uncompressed
    // - subgroup_check
    // - consume in Pairing.aggregate as affine, or mul_n_aggregate as affine
    // Just send the raw signture recevied as bytes to the thread and verify there

    // Pubkeys all come from cache (trusted) have already been checked for subgroup and infinity
    // - Some pubkeys will have to be aggregated, some don't
    // - Pubkeys must be available in jacobian coordinates to make aggregation x3 faster
    // - Then, consume in Pairing.aggregate as affine, or mul_n_aggregate as affine

    // All signatures are not trusted and must be group checked (p2.subgroup_check)

    // Public keys have already been checked for subgroup and infinity
    // Signatures have already been checked for subgroup
    // Signature checks above could be done here for convienence as well
    return this.pool.verifyMultipleAggregateSignatures(
      signatureSets.map((signatureSet) => ({
        publicKey: getAggregatedPubkey(signatureSet),
        message: signatureSet.signingRoot as Uint8Array,
        signature: signatureSet.signature,
      }))
    );
  }
}

function getAggregatedPubkey(signatureSet: ISignatureSet): PublicKey {
  switch (signatureSet.type) {
    case SignatureSetType.single:
      return signatureSet.pubkey;

    case SignatureSetType.aggregate:
      return bls.PublicKey.aggregate(signatureSet.pubkeys);

    default:
      throw Error("Unknown signature set type");
  }
}
