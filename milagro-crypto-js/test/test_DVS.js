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

/* Test DVS - test driver and function exerciser for Designated Veifier Signature API Functions */

var chai = require('chai');

var CTX = require("../index");

pf_curves = ['BN254', 'BN254CX', 'BLS381', 'BLS383', 'BLS461', 'FP256BN', 'FP512BN', 'BLS24', 'BLS48'];

var expect = chai.expect;

pf_curves.forEach(function(curve) {

    var ctx = new CTX(curve);

    describe('TEST DVS ' + curve, function() {

        var rng = new ctx.RAND(),
            sha = ctx.ECP.HASH_TYPE,
            MPIN, EGS, EFS, G1S, G2S,
            pin = 1234,
            pin2 = 2345,
            IDstr = "testuser@miracl.com",
            message = "Message to sign",
            S = [],
            SST = [],
            TOKEN = [],
            SEC = [],
            xID = [],
            X = [],
            Y1 = [],
            Y2 = [],
            Z = [],
            Pa = [],
            U = [],
            RAW = [],
            CLIENT_ID, rtn, date, timeValue, i;

        if (ctx.ECP.CURVE_PAIRING_TYPE === 1 | ctx.ECP.CURVE_PAIRING_TYPE === 2) {
            MPIN = ctx.MPIN;
            G2S = 4 * MPIN.EFS;
        } else if (ctx.ECP.CURVE_PAIRING_TYPE === 3) {
            MPIN = ctx.MPIN192;
            G2S = 8 * MPIN.EFS;
        } else if (ctx.ECP.CURVE_PAIRING_TYPE === 4) {
            MPIN = ctx.MPIN256;
            G2S = 16 * MPIN.EFS;
        }
        EGS = MPIN.EGS;
        EFS = MPIN.EFS;
        G1S = 2 * EFS + 1;

        before(function(done) {
            this.timeout(0);

            rng.clean();
            for (i = 0; i < 100; i++) RAW[i] = i;
            rng.seed(100, RAW);

            /* Trusted Authority set-up */
            MPIN.RANDOM_GENERATE(rng, S);

            /* Create Client Identity */
            CLIENT_ID = MPIN.stringtobytes(IDstr);

            /* Generate ctx.RANDom public key and z */
            MPIN.GET_DVS_KEYPAIR(rng, Z, Pa);

            /* Append Pa to ID */
            for (i = 0; i < Pa.length; i++)
                CLIENT_ID.push(Pa[i]);

            /* Hash Client ID */
            HCID = MPIN.HASH_ID(sha, CLIENT_ID);

            /* Client and Server are issued secrets by DTA */
            MPIN.GET_SERVER_SECRET(S, SST);
            MPIN.GET_CLIENT_SECRET(S, HCID, TOKEN);

            /* Compute client secret for key escrow less scheme z.CS */
            MPIN.GET_G1_MULTIPLE(null, 0, Z, TOKEN, TOKEN);

            /* Client extracts PIN from secret to create Token */
            MPIN.EXTRACT_PIN(sha, CLIENT_ID, pin, TOKEN);

            done();
        });

        it('test Good Signature', function(done) {
            this.timeout(0);

            date = 0;
            timeValue = MPIN.GET_TIME();

            rtn = MPIN.CLIENT(sha, 0, CLIENT_ID, rng, X, pin, TOKEN, SEC, U, null, null, timeValue, Y1, message);
            expect(rtn).to.be.equal(0);

            /* Server  */
            rtn = MPIN.SERVER(sha, 0, xID, null, Y2, SST, U, null, SEC, null, null, CLIENT_ID, timeValue, message, Pa);
            expect(rtn).to.be.equal(0);
            done();
        });

        it('test Bad Signature', function(done) {
            this.timeout(0);

            date = 0;
            timeValue = MPIN.GET_TIME();

            rtn = MPIN.CLIENT(sha, 0, CLIENT_ID, rng, X, pin2, TOKEN, SEC, U, null, null, timeValue, Y1, message);
            expect(rtn).to.be.equal(0);

            /* Server  */
            rtn = MPIN.SERVER(sha, 0, xID, null, Y2, SST, U, null, SEC, null, null, CLIENT_ID, timeValue, message, Pa);
            expect(rtn).to.be.equal(MPIN.BAD_PIN);
            done();
        });
    });
});