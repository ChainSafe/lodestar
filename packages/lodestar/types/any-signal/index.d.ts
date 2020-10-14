declare module "any-signal" {
  import {AbortSignal} from "abort-controller";

  export function anySignal(signals: AbortSignal[]): AbortSignal;
}
