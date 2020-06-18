import {Stream, Transform} from "stream";
import {IncomingMessage} from "http";
import {FastifyRequest} from "fastify";
import {ILogger} from "@chainsafe/lodestar-utils";

export class FastifyLogger {

  public readonly stream: Stream;

  public readonly serializers = {
    req: (request: IncomingMessage&FastifyRequest) => {
      return {msg: `${request.ip} -> ${request.hostname}\t${request.method}:${request.url}\tRequestId: ${request.id}`};
    },
  };

  constructor(logger: ILogger) {
    this.stream = new Transform({
      objectMode: true,
      transform: this.transform
    });
    this.stream.pipe(logger.stream());
  }

  private transform = (
    chunk: string, encoding: string, callback: (error?: (Error | null), data?: {level: string; message: string}) => void
  ): void =>  {
    const log: {
      msg: string; responseTime: number; reqId: number; req?: {msg: string}; res?: {statusCode: number};
    } = JSON.parse(chunk);
    if(log.req) {
      callback(null, {level: "debug", message: log.req.msg});
    } else if(log.res) {
      callback(
        null,
        {
          level: "debug",
          message: `RequestId: ${log.reqId}\tStatusCode: ${log.res.statusCode}\tResponseTime: ${log.responseTime} ms`
        }
      );
    } else {
      callback(null, {level: "info", message: log.msg});
    }

  };

}
