export enum ClockEventType {
  CLOCK_SLOT = "clock_slot",
  CLOCK_EPOCH = "clock_epoch",
}

export type ClockSlotEvent = {
  type: typeof ClockEventType.CLOCK_SLOT;
  message: {
    slot: number;
  };
};

export type ClockEpochEvent = {
  type: typeof ClockEventType.CLOCK_EPOCH;
  message: {
    epoch: number;
  };
};
