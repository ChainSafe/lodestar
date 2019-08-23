import {assert} from "chai";
import * as request from "supertest";
import {JSONRPC, TransportType} from "../../../../src/rpc";
import {MockValidatorApi} from "../../../utils/mocks/rpc/validator";
import HttpServer from "../../../../src/rpc/transport/http";
import {generateRPCCall} from "../../../utils/rpcCall";
import {MockBeaconApi} from "../../../utils/mocks/rpc/beacon";
import {ILogger, WinstonLogger} from "../../../../src/logger";

describe("Json RPC over http", () => {
  let rpc;
  let server;
  let logger: ILogger = new WinstonLogger();

  before(async () => {
    logger.silent = true;
    const rpcServer = new HttpServer({
      host: '127.0.0.1',
      port: 32421,
      type: TransportType.HTTP
    }, {logger: logger});
    server = rpcServer.server;
    rpc = new JSONRPC(
      {},
      {
        transports: [
          rpcServer
        ],
        apis: [
          new MockBeaconApi(),
          new MockValidatorApi()
        ]
      });
    await rpc.start();
  });

  after(async () => {
    await rpc.stop();
    logger.silent = false;
  });

  it("should get the beacon api version", (done) => {
    request.default(server)
      .post('/')
      .send(generateRPCCall('beacon.getFork', []))
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function (err, res) {
        if (err) return done(err);
        if (res.body.error) {
          return done(res.body.error);
        }
        done();
      });
  });

  it("should get the validator api isProposer", (done) => {
    request.default(server)
      .post('/')
      .send(generateRPCCall('validator.isProposer', [0, 0]))
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function (err, res) {
        if (err) return done(err);
        if (res.body.error) {
          return done(res.body.error);
        }
        done();
      });
  });

  it("should fail for unknown methods", (done) => {
    request.default(server)
      .post('/')
      .send(generateRPCCall('beacon.notExistingMethod', []))
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(200)
      .end(function (err, res) {
        if (err) return done(err);
        if (res.body.error) {
          return done();
        }
        assert.fail('Should not be successfull');
        done();
      });
  });
  it("should fail for methods other than POST", (done) => {
    request.default(server)
      .get('/')
      .set('Accept', 'application/json')
      .expect(400)
      .end((err) => {
        done(err);
      });
  });
  it("should fail to start on existing port", (done) => {
    const rpc = new JSONRPC(
      {},
      {transports: [new HttpServer({
          host: '127.0.0.1',
          port: 32421,
          type: TransportType.HTTP
        }, {logger: logger})],
        apis: [new MockValidatorApi()]});
    rpc.start()
      .then(async () => {
        await rpc.stop();
        done(new Error('Should not be able to start!'));
      })
      .catch((e) => {
        done();
      });
  });
});
