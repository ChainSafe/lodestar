export const MS_IN_SEC = 1000;

export class EpochClock {
  private readonly genesisTime: number;
  private readonly secondsPerSlot: number;

  readonly slotsPerEpoch: number;

  constructor({
    genesisTime,
    secondsPerSlot,
    slotsPerEpoch,
  }: {
    genesisTime: number;
    secondsPerSlot: number;
    slotsPerEpoch: number;
  }) {
    this.genesisTime = genesisTime;
    this.secondsPerSlot = secondsPerSlot;
    this.slotsPerEpoch = slotsPerEpoch;
  }

  timeSinceGenesis(): number {
    return Math.floor(Date.now() / MS_IN_SEC - this.genesisTime);
  }

  get currentSlot(): number {
    return this.getSlotFor();
  }

  get currentEpoch(): number {
    return Math.floor(this.currentSlot / this.slotsPerEpoch);
  }

  getLastSlotOfEpoch(epoch: number): number {
    return (epoch + 1) * this.slotsPerEpoch - 1;
  }

  getFirstSlotOfEpoch(epoch: number): number {
    return epoch * this.slotsPerEpoch;
  }

  getEpochForSlot(slot: number): number {
    return Math.floor(slot / this.slotsPerEpoch);
  }

  getSlotFor(timeStamp?: number): number {
    const time = timeStamp ?? Math.floor(Date.now() / MS_IN_SEC);
    const elapsedTime = time - this.genesisTime;

    return Math.floor(elapsedTime / this.secondsPerSlot);
  }

  getSlotTime(slot: number): number {
    const slotGenesisTimeOffset = slot * this.secondsPerSlot;

    return this.genesisTime + slotGenesisTimeOffset;
  }

  isFirstSlotOfEpoch(slot: number): boolean {
    return slot % this.slotsPerEpoch === 0;
  }

  isLastSlotOfEpoch(slot: number): boolean {
    return slot % this.slotsPerEpoch === this.slotsPerEpoch - 1;
  }
}
