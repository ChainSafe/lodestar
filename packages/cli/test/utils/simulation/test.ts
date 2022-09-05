import {EpochClock} from "./EpochClock.js";

const genesisTime = Math.floor(Date.now() / 1000) - 30;
const clock = new EpochClock({genesisTime: 0, secondsPerSlot: 1, slotsPerEpoch: 8, signal: new AbortController().signal});

console.log("Current Slot:", clock.currentSlot);
console.log("Current Epoch:", clock.currentEpoch);
console.log("0 =>", clock.getFirstSlotOfEpoch(0), clock.getLastSlotOfEpoch(0));
console.log("1 =>", clock.getFirstSlotOfEpoch(1), clock.getLastSlotOfEpoch(1));
console.log("2 =>", clock.getFirstSlotOfEpoch(2), clock.getLastSlotOfEpoch(2));
console.log("3 =>", clock.getFirstSlotOfEpoch(3), clock.getLastSlotOfEpoch(3));

console.log("Slot time:");
console.log("0 =>", clock.getSlotTime(0));
console.log("1 =>", clock.getSlotTime(1));
console.log("2 =>", clock.getSlotTime(2));
