/**
 * Payload status for ePBS (Gloas fork)
 * Spec: gloas/fork-choice.md#constants
 */
export enum PayloadStatus {
  PENDING = 0,
  EMPTY = 1,
  FULL = 2,
}
