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

  private log: ILogger;

  constructor(logger: ILogger) {
    this.log = logger;
    this.stream = {
      write: this.handle,
    } as unknown as Stream;
  }

  private handle = (
    chunk: string
  ): void =>  {
    const log: {
      level: number; msg: string; responseTime: number; reqId: number; req?: {msg: string}; res?: {statusCode: number};
    } = JSON.parse(chunk);
    if(log.req) {
      this.log.debug(log.req.msg);
    } else if(log.res) {

      this.log.debug(`Response: StatusCode: ${log.res.statusCode}\tResponseTime:`
          +` ${log.responseTime} ms\tRequestId: ${log.reqId}`);
    } else {
      if(log.level === 50) {
        this.log.error(log.msg);
      } else {
        this.log.warn(log.msg);
      }
    }

  };

}
