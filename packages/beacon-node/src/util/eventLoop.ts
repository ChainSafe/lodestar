import {sleep} from "@lodestar/utils";

/**
 * Schedules in 1ms a Promise to be resolved during the `timers` phase.
 * Awaiting this Promise will force the whole event queue to be executed.
 *
 * Caution: as the execution of the event queue might lead to new enqueuing, this might take significant time.
 */
export function nextEventLoop(): Promise<void> {
  // `setTimeout` delay is at least 1ms
  // Say https://nodejs.org/api/timers.html#settimeoutcallback-delay-args
  return sleep(0);
}

/**
 * Schedules in 1ms a callback for execution during the next `timers` phase.
 */
export function callInNextEventLoop(callback: () => void): void {
  // `setTimeout` delay is at least 1ms
  // Say https://nodejs.org/api/timers.html#settimeoutcallback-delay-args
  setTimeout(callback, 0);
}
