import {Match, Matcher} from "../interfaces.js";

export const everySlotMatcher: Matcher = ({slot}) => (slot >= 0 ? Match.Capture | Match.Assert : Match.None);

export const everyEpochMatcher: Matcher = ({slot, clock}) =>
  clock.isLastSlotOfEpoch(slot) ? Match.Capture | Match.Assert : Match.Capture;

export const neverMatcher: Matcher = () => Match.None;

export const onceOnSlotMatcher =
  (userSlot: number): Matcher =>
  ({slot}) =>
    slot === userSlot ? Match.Capture | Match.Assert : Match.None;

export const onceOnStartupMatcher = onceOnSlotMatcher(1);
