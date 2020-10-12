import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {EventEmitter} from "events";
import {IRespEventEmitterClass} from ".";
import {createResponseEvent, ResponseCallbackFn} from "..";
import {RESP_TIMEOUT, RpcResponseStatus} from "../../constants";
import {IResponseChunk} from "../encoders/interface";
import {encodeP2pErrorMessage} from "../encoders/response";

export class ResponseEventListener extends (EventEmitter as IRespEventEmitterClass) {
  public waitForResponse(
    config: IBeaconConfig,
    requestId: string,
    responseListener: ResponseCallbackFn
  ): NodeJS.Timeout {
    const responseEvent = createResponseEvent(requestId);
    this.once(responseEvent, responseListener);
    return setTimeout(() => {
      this.removeListener(responseEvent, responseListener);
      const errorGenerator: AsyncGenerator<IResponseChunk> = (async function* () {
        yield {
          requestId,
          status: RpcResponseStatus.SERVER_ERROR,
          body: encodeP2pErrorMessage(config, "Timeout processing request"),
        };
      })();
      responseListener(errorGenerator);
    }, RESP_TIMEOUT);
  }
}
