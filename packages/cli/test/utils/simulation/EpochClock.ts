export const MS_IN_SEC = 1000;

export class EpochClock {
  private readonly genesisTime: number;
  private readonly secondsPerSlot: number;
  private readonly signal: AbortSignal;

  readonly slotsPerEpoch: number;

  constructor({
    genesisTime,
    secondsPerSlot,
    slotsPerEpoch,
    signal,
  }: {
    genesisTime: number;
    secondsPerSlot: number;
    slotsPerEpoch: number;
    signal: AbortSignal;
  }) {
    this.genesisTime = genesisTime;
    this.secondsPerSlot = secondsPerSlot;
    this.slotsPerEpoch = slotsPerEpoch;
    this.signal = signal;
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

  getSlotIndexInEpoch(slot: number): number {
    return slot % this.slotsPerEpoch;
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

  waitForStartOfSlot(slot: number): Promise<this> {
    // eslint-disable-next-line no-console
    console.log("Waiting for start of slot", {target: slot, current: this.currentSlot});

    return new Promise((resolve) => {
      const slotTime = this.getSlotTime(slot) * MS_IN_SEC - Date.now();

      const timeout = setTimeout(() => {
        resolve(this);
      }, slotTime);

      this.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
        },
        {once: true}
      );
    });
  }

  waitForEndOfSlot(slot: number): Promise<this> {
    return this.waitForStartOfSlot(slot + 1);
  }

  waitForStartOfEpoch(epoch: number): Promise<this> {
    return this.waitForStartOfSlot(this.getFirstSlotOfEpoch(epoch));
  }

  waitForEndOfEpoch(epoch: number): Promise<this> {
    return this.waitForEndOfSlot(this.getLastSlotOfEpoch(epoch));
  }
}
