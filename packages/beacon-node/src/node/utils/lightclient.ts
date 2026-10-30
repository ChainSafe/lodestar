import {LightClientServerError, LightClientServerErrorCode} from "../../chain/errors/lightClientError.js";

export function assertLightClientServerEnabled(disabled: boolean | undefined): void {
  if (disabled) {
    throw new LightClientServerError({code: LightClientServerErrorCode.DISABLED}, "Light client server is disabled");
  }
}
