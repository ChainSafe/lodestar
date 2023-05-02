import {ReqRespMethod} from "@lodestar/reqresp";

export type RequestTypedContainer = {
  method: string & ReqRespMethod;
  body: unknown;
};
