import {IApiClient, IApiClientValidator} from "./interface";

// eslint-disable-next-line @typescript-eslint/naming-convention
export function ApiClientOverInstance(api: IApiClient): IApiClientValidator {
  return {
    beacon: api.beacon,
    validator: api.validator,
    events: api.events,
    node: api.node,
    config: api.config,

    url: "inmemory",
    registerAbortSignal() {
      // Does not support aborting
    },
  };
}
