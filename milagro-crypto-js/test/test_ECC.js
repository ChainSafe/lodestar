/*
Licensed to the Apache Software Foundation (ASF) under one
or more contributor license agreements.  See the NOTICE file
distributed with this work for additional information
regarding copyright ownership.  The ASF licenses this file
to you under the Apache License, Version 2.0 (the
"License"); you may not use this file except in compliance
with the License.  You may obtain a copy of the License at

  http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing,
software distributed under the License is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either exprtns or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/


/* Test ECC - test driver and function exerciser for ECDH/ECIES/ECDSA API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var all_curves = ['ED25519', 'GOLDILOCKS', 'NIST256', 'BRAINPOOL', 'ANSSI', 'HIFIVE', 'C25519', 'SECP256K1', 'NIST384', 'C41417', 'NIST521', 'NUMS256W',
    'NUMS256E', 'NUMS384W', 'NUMS384E', 'NUMS512W', 'NUMS512E', 'BN254', 'BN254CX', 'BLS381', 'BLS383', 'BLS461', 'FP256BN', 'FP512BN', 'BLS24', 'BLS48'
];

all_curves.forEach(function(curve) {

    var ctx = new CTX(curve);

    describe('TEST ECC ' + curve, function() {

        var pp = "M0ng00se",
            sha = ctx.ECP.HASH_TYPE,
            S1 = [],
            W0 = [],
            W1 = [],
            Z0 = [],
            Z1 = [],
            RAW = [],
            SALT = [],
            P1 = [],
            P2 = [],
            V = [],
            M1 = [],
            CS = [],
            DS = [],
            rng = new ctx.RAND(),
            T = new Array(12), // must specify required length
            PW, KEY1, KEY2, C, M2, S0, rtn;

        before(function(done) {
            this.timeout(0);
            rng.clean();
            for (i = 0; i < 100; i++) RAW[i] = i;
            rng.seed(100, RAW);
            for (i = 0; i < 8; i++) SALT[i] = (i + 1); // set Salt
            PW = ctx.ECDH.stringtobytes(pp);
            // private key S0 of size EGS bytes derived from Password and Salt 
            S0 = ctx.ECDH.PBKDF2(sha, PW, SALT, 1000, ctx.ECDH.EGS);
            done();
        });


        it('test ECDH', function(done) {
            this.timeout(0);

            // Generate Key pair S/W 
            ctx.ECDH.KEY_PAIR_GENERATE(null, S0, W0);

            rtn = ctx.ECDH.PUBLIC_KEY_VALIDATE(W0);
            expect(rtn).to.be.equal(0);
            // Random private key for other party 
            ctx.ECDH.KEY_PAIR_GENERATE(rng, S1, W1);

            rtn = ctx.ECDH.PUBLIC_KEY_VALIDATE(W1);
            expect(rtn).to.be.equal(0);

            // Calculate common key using DH - IEEE 1363 method 

            ctx.ECDH.ECPSVDP_DH(S0, W1, Z0);
            ctx.ECDH.ECPSVDP_DH(S1, W0, Z1);

            var same = true;
            for (i = 0; i < ctx.ECDH.EFS; i++)
                if (Z0[i] != Z1[i]) same = false;


            KEY1 = ctx.ECDH.KDF2(sha, Z0, null, ctx.ECP.AESKEY);
            KEY2 = ctx.ECDH.KDF2(sha, Z1, null, ctx.ECP.AESKEY);

            expect(KEY1.toString()).to.be.equal(KEY2.toString());
            done();
        });

        if (ctx.ECP.CURVETYPE != ctx.ECP.MONTGOMERY) {
            it('test ECIES', function(done) {
                this.timeout(0);
                P1[0] = 0x0;
                P1[1] = 0x1;
                P1[2] = 0x2;
                P2[0] = 0x0;
                P2[1] = 0x1;
                P2[2] = 0x2;
                P2[3] = 0x3;

                for (i = 0; i <= 16; i++) M1[i] = i;

                C = ctx.ECDH.ECIES_ENCRYPT(sha, P1, P2, rng, W1, M1, V, T);

                M2 = ctx.ECDH.ECIES_DECRYPT(sha, P1, P2, V, C, T, S1);

                expect(M1.toString()).to.equal(M2.toString());

                done();
            });

            it('test ECDSA', function(done) {
                this.timeout(0);
                expect(ctx.ECDH.ECPSP_DSA(sha, rng, S0, M1, CS, DS)).to.be.equal(0);
                expect(ctx.ECDH.ECPVP_DSA(sha, W0, M1, CS, DS)).to.be.equal(0);
                done();
            });
        }
    });
});
