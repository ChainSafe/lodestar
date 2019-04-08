import {LikeSocketServer} from "../protocol";
import {LikeSocket} from "noice-json-rpc";
import http from "http";
import promisify from "promisify-es6";

export interface HttpServerOpts {
    port: number;
}

export default class HttpServer implements LikeSocketServer{

    public server: http.Server;

    private opts: HttpServerOpts;

    private connectionCallback: Function;

    constructor(opts: HttpServerOpts) {
        this.opts = opts;
        this.server = http.createServer(async (req, resp) => {
            if (req.method === 'POST') {
                if(this.connectionCallback) {
                    this.connectionCallback(new MessageRequest(req, resp));
                }
            } else {
                resp.writeHead(400);
                resp.write('Unsupported method');
                resp.end();
            }
        });
    }

    on(event: string, cb: Function): any {
        if (event === 'connection') {
            this.connectionCallback = cb;
        }
    }

    async start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server.listen(this.opts.port)
                .on('listening', resolve)
                .on('error', e => reject(e));
        });
    }

    async stop(): Promise<void> {
        await promisify(this.server.close.bind(this.server))();
    }

}


class MessageRequest implements LikeSocket {

    private resp: http.ServerResponse;
    private req: http.IncomingMessage;

    private messageCallback: Function;

    constructor(req: http.IncomingMessage, resp: http.ServerResponse) {
        this.req = req;
        this.resp = resp;
    }

    on(event: string, cb: Function): any {
        if(event === 'message') {
            const that = this;
            this.messageCallback = cb;
            this.getRequest(this.req)
                .then((message) => {
                    if(that.messageCallback) {
                        that.messageCallback(message);
                    }
                })
        }
    }

    removeListener(event: string, cb: Function): any {
    }

    send(message: string): void {
        this.sendJsonResponse(message);
    }

    private sendJsonResponse(message: string) {
        this.resp.writeHead(200, {'Content-Type': 'application/json'});
        this.resp.write(message);
        this.resp.end();
    }

    private getRequest(req: http.IncomingMessage): Promise<any> {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', chunk => {
                body += chunk.toString();
            });
            req.on('end', () => {
                resolve(body);
            });
        });
    }

}
