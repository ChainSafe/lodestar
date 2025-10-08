export interface ProcessBlockOpts {
  verifySignatures?: boolean;
}

export enum ProposerRewardType {
  attestation = "attestation",
  syncAggregate = "sync_aggregate",
  slashing = "slashing",
}
