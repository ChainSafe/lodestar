export interface ISlotComponentClock {
  msToAttestationDue(slot: number): number;
  secFromAttestationDue(slot: number): number;
  msToAggregateDue(slot: number): number;
  secFromAggregateDue(slot: number): number;
  msToSyncMessageDue(slot: number): number;
  secFromSyncMessageDue(slot: number): number;
  msToSyncContributionDue(slot: number): number;
  secFromSyncContributionDue(slot: number): number;
}
