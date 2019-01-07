/*
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
'License'); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
'AS IS' BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/

/* Test RSA - test driver and function exerciser for RSA API Functions */

var CTX = require("../index");

var chai = require('chai');
var expect = chai.expect;

describe('TEST RSA RSA3072', function() {

    var ctx = new CTX('RSA3072');

    // Load test vectors
    var vectors = require('../testVectors/rsa/RSA3072.json');
    var i, j = 0,
        res;
    var result;
    var RAW = [];
    var rng = new ctx.RAND();
    var sha;
    var message;
    var pub;
    var priv;

    var ML = [];
    var C = [];
    var S = [];
    var M;
    var E;

    j = 1;

    before(function(done) {

        rng.clean();
        for (i = 0; i < 100; i++) RAW[i] = i;
        rng.seed(100, RAW);
        sha = ctx.RSA.HASH_TYPE;
        done();
    });

    it('test RSA Enctyption/Decryption', function(done) {
        this.timeout(0);

        message = 'Hello World\n';

        pub = new ctx.rsa_public_key(ctx.FF.FFLEN);
        priv = new ctx.rsa_private_key(ctx.FF.HFLEN);

        for (vector in vectors) {

            ctx.FF.fromBytes(priv.p, Buffer.from(vectors[vector].PrivP, "hex"));
            ctx.FF.fromBytes(priv.q, Buffer.from(vectors[vector].PrivQ, "hex"));
            ctx.FF.fromBytes(priv.dp, Buffer.from(vectors[vector].PrivDP, "hex"));
            ctx.FF.fromBytes(priv.dq, Buffer.from(vectors[vector].PrivDQ, "hex"));
            ctx.FF.fromBytes(priv.c, Buffer.from(vectors[vector].PrivC, "hex"));
            ctx.FF.fromBytes(pub.n, Buffer.from(vectors[vector].PubN, "hex"));
            pub.e = vectors[vector].PubE;
            M = ctx.RSA.stringtobytes(message);
            E = ctx.RSA.OAEP_ENCODE(sha, M, rng, null); /* OAEP encode message m to e  */
            ctx.RSA.ENCRYPT(pub, E, C); /* encrypt encoded message */
            ctx.RSA.DECRYPT(priv, C, ML);
            var cmp = true;
            if (E.length != ML.length) cmp = false;
            else {
                for (var j = 0; j < E.length; j++)
                    if (E[j] != ML[j]) cmp = false;
            }
            expect(cmp).to.be.equal(true);
            var MS=ctx.RSA.OAEP_DECODE(sha,null,ML); /* OAEP decode message  */
            if (MS.length != M.length) cmp = false;
            else {
                for (var j = 0; j < MS.length; j++)
                    if (MS[j] != M[j]) cmp = false;
            }
            expect(cmp).to.be.equal(true);
        }
        done();
    });

    it('test RSA Signature', function(done) {
        this.timeout(0);

        for (vector in vectors) {

            ctx.FF.fromBytes(priv.p, Buffer.from(vectors[vector].PrivP, "hex"));
            ctx.FF.fromBytes(priv.q, Buffer.from(vectors[vector].PrivQ, "hex"));
            ctx.FF.fromBytes(priv.dp, Buffer.from(vectors[vector].PrivDP, "hex"));
            ctx.FF.fromBytes(priv.dq, Buffer.from(vectors[vector].PrivDQ, "hex"));
            ctx.FF.fromBytes(priv.c, Buffer.from(vectors[vector].PrivC, "hex"));
            ctx.FF.fromBytes(pub.n, Buffer.from(vectors[vector].PubN, "hex"));
            pub.e = vectors[vector].PubE;

            ctx.RSA.PKCS15(sha, M, C);

            ctx.RSA.DECRYPT(priv, C, S); /* create signature in S */

            ctx.RSA.ENCRYPT(pub, S, ML);
            var cmp = true;
            if (C.length != ML.length) cmp = false;
            else {
                for (var j = 0; j < C.length; j++)
                    if (C[j] != ML[j]) cmp = false;
            }
            expect(cmp).to.be.equal(true);
            ctx.RSA.PRIVATE_KEY_KILL(priv);
        }
        done();
    });
});