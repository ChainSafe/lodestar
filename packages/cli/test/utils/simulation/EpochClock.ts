const MS_IN_SEC = 1000;

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
    this.signal = signal;
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

  waitForSlot(slot: number): Promise<void> {
    return new Promise((resolve) => {
      const slotTime = this.getSlotTime(slot) * MS_IN_SEC - Date.now();

      const timeout = setTimeout(() => {
        resolve();
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

  waitForEndOfEpoch(epoch: number): Promise<void> {
    return this.waitForSlot(this.getLastSlotOfEpoch(epoch));
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
}
