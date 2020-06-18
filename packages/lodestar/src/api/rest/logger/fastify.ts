import {Stream} from "stream";
import {IncomingMessage} from "http";
import {FastifyRequest} from "fastify";
import {ILogger} from "@chainsafe/lodestar-utils";

export class FastifyLogger {

  public readonly stream: Stream;

  public readonly serializers = {
    req: (request: IncomingMessage&FastifyRequest) => {
      return {
        msg: `Request: ${request.ip} -> ${request.hostname}\t${request.method}:${request.url}\tRequestId: ${request.id}`
      };
    },
  };

  private winston: ILogger;

  constructor(logger: ILogger) {
    this.winston = logger;
    this.stream = {
      write: this.handle,
    } as unknown as Stream;
  }

  private handle = (
    chunk: string
  ): void =>  {
    const log: {
      msg: string; responseTime: number; reqId: number; req?: {msg: string}; res?: {statusCode: number};
    } = JSON.parse(chunk);
    if(log.req) {
      this.winston.debug(log.req.msg);
    } else if(log.res) {

      this.winston.debug(`Response: StatusCode: ${log.res.statusCode}\tResponseTime:`
          +` ${log.responseTime} ms\tRequestId: ${log.reqId}`);
    } else {
      this.winston.warn(log.msg);
    }

  };

}
