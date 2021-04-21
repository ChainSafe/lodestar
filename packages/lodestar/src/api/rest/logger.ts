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
    req: (req: IncomingMessage & FastifyRequest): {msg: string} => {
      const url = req.url ? req.url.split("?")[0] : "-";
      return {msg: `Req ${req.id} ${req.ip} ${req.method}:${url}`};
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
      this.log.debug(`Res ${log.reqId} - ${log.res.statusCode} ${log.responseTime}`);
    } else {
      if (log.level === 50) {
        this.log.error(log.msg);
      } else {
        this.log.warn(log.msg);
      }
    }
  };
}
