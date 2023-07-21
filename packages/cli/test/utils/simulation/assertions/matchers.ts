import {AssertionMatch, AssertionMatcher} from "../interfaces.js";

export const everySlotMatcher: AssertionMatcher = ({slot}) =>
  slot >= 0 ? AssertionMatch.Capture | AssertionMatch.Assert : AssertionMatch.None;

export const everyEpochMatcher: AssertionMatcher = ({slot, clock}) =>
  clock.isLastSlotOfEpoch(slot) ? AssertionMatch.Capture | AssertionMatch.Assert : AssertionMatch.Capture;

export const neverMatcher: AssertionMatcher = () => AssertionMatch.None;

export const onceOnSlotMatcher =
  (userSlot: number): AssertionMatcher =>
  ({slot}) =>
    slot === userSlot ? AssertionMatch.Capture | AssertionMatch.Assert : AssertionMatch.None;

export const onceOnStartupMatcher = onceOnSlotMatcher(1);
