/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {Stream} from "stream";
import {IncomingMessage} from "http";
import {FastifyRequest} from "fastify";
import {ILogger} from "@chainsafe/lodestar-utils";

/**
 * Logs REST API request/response messages.
 */
export class FastifyLogger {
  readonly stream: Stream;

  readonly serializers = {
    req: (request: IncomingMessage & FastifyRequest) => {
      return {
        // eslint-disable-next-line max-len
        msg: `Request: ${request.ip} -> ${request.hostname}\t${request.method}:${request.url}\tRequestId: ${request.id}`,
      };
    },
  };

  private log: ILogger;

  constructor(logger: ILogger) {
    this.log = logger;
    this.stream = ({
      write: this.handle,
    } as unknown) as Stream;
  }

  private handle = (chunk: string): void => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const log = JSON.parse(chunk);
    if (log.req) {
      this.log.debug(log.req.msg);
    } else if (log.res) {
      this.log.debug(
        `Response: StatusCode: ${log.res.statusCode}\tResponseTime:` +
          ` ${log.responseTime} ms\tRequestId: ${log.reqId}`
      );
    } else {
      if (log.level === 50) {
        this.log.error(log.msg);
      } else {
        this.log.warn(log.msg);
      }
    }
  };
}
