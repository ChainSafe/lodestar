import {assert} from "chai";
import * as request from "supertest";
import {JSONRPC} from "../../../src/rpc";
import {MockValidatorApi} from "../../utils/mocks/rpc/validator";
import HttpServer from "../../../src/rpc/transport/http";
import {generateRPCCall} from "../../utils/rpcCall";
import logger from "../../../src/logger/winston";

describe("Json RPC over http", () => {
    let rpc;
    let server;
    before(async () => {
        logger.silent(true);
        const rpcServer = new HttpServer({port: 32421});
        server = rpcServer.server;
        rpc = new JSONRPC({}, {transport: rpcServer, api: new MockValidatorApi()});
        await rpc.start();
    });
    after(async () => {
        await rpc.stop();
        logger.silent(false);
    });
    it("should get the chain head", (done) => {
        request.default(server)
            .post('/')
            .send(generateRPCCall('BeaconChain.getFork', []))
            .set('Accept', 'application/json')
            .expect('Content-Type', /json/)
            .expect(200)
            .end(function (err, res) {
                if (err) return done(err);
                if (res.body.error) {
                    return done(res.body.error)
                }
                done();
            });
    });
    it("should fail for unknown methods", (done) => {
        request.default(server)
            .post('/')
            .send(generateRPCCall('BeaconChain.notExistingMethod', []))
            .set('Accept', 'application/json')
            .expect('Content-Type', /json/)
            .expect(200)
            .end(function (err, res) {
                if (err) return done(err);
                if (res.body.error) {
                    return done()
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
        const rpc = new JSONRPC({}, {transport: new HttpServer({port: 32421}), api: new MockValidatorApi()});
        rpc.start()
            .then(async () => {
                await rpc.stop();
                done(new Error('Should not be able to start!'));
            })
            .catch((e) => {
                done();
            })
    })
});
