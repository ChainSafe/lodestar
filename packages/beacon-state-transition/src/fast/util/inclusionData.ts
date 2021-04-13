/**
 * Data to track the best attestation inclusion per validator
 *
 * This is only needed in phase0
 * when attestation processing is deferred to epoch processing
 */
export interface IInclusionData {
  inclusionDelay: number;
  proposerIndex: number;
}
