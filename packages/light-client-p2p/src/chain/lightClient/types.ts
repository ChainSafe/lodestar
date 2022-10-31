/**
 * We aren't creating the sync committee proofs separately because our ssz library automatically adds leaves to composite types,
 * so they're already included in the state proof, currently with no way to specify otherwise
 *
 * remove two offsets so the # of offsets in the state proof will be the # expected
 * This is a hack, but properly setting the offsets in the state proof would require either removing witnesses needed for the committees
 * or setting the roots of the committees in the state proof
 * this will always be 1, syncProofLeavesLength
 *
 *
 * With empty state (minimal)
 * - `genesisTime = 0xffffffff`
 * - `genesisValidatorsRoot = Buffer.alloc(32, 1)`
 *
 * Proof:
 * ```
 * offsets: [ 5, 4, 3, 2, 1 ]
 * leaves: [
 *   '0xffffffff00000000000000000000000000000000000000000000000000000000',
 *   '0x0101010101010101010101010101010101010101010101010101010101010101',
 *   '0xb11b8bcf59425d6c99019cca1d2c2e47b51a2f74917a67ad132274f43e13ec43',
 *   '0x74bd1f2437cdf74b0904ee525d8da070a3fa27570942bf42cbab3dc5939600f0',
 *   '0x7f06739e5a42360c56e519a511675901c95402ea9877edc0d9a87471b1374a6a',
 *   '0x9f534204ba3c0b69fcb42a11987bfcbc5aea0463e5b0614312ded4b62cf3a380'
 * ]
 * ```
 */
export type SyncCommitteeWitness = {
  /** Vector[Bytes32, 4] */
  witness: Uint8Array[];
  currentSyncCommitteeRoot: Uint8Array;
  nextSyncCommitteeRoot: Uint8Array;
};
