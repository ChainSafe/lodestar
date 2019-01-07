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
KIND, either express or implied.  See the License for the
specific language governing permissions and limitations
under the License.
*/

/* Test MPIN - test driver and function exerciser for MPIN API Functions */

var CTX = require("../index");

var chai = require('chai');

var expect = chai.expect;

// Curves for consistency test
var pf_curves = ['BN254', 'BN254CX', 'BLS381', 'BLS383', 'BLS461', 'FP256BN', 'FP512BN', 'BLS24', 'BLS48'];

// Curves for test with test vectors
var tv_curves = ['BN254CX'];

hextobytes = function(value_hex) {
    // "use strict";
    var len, byte_value, i;

    len = value_hex.length;
    byte_value = [];

    for (i = 0; i < len; i += 2) {
        byte_value[(i / 2)] = parseInt(value_hex.substr(i, 2), 16);
    }
    return byte_value;
};

pf_curves.forEach(function(curve) {

    describe('TEST MPIN ' + curve, function() {

        var ctx = new CTX(curve),
            rng = new ctx.RAND(),
            MPIN, EGS, EFS, G1S, G2S,
            S1 = [],
            S2 = [],
            SST1 = [],
            SST2 = [],
            TOKEN1 = [],
            TOKEN2 = [],
            PERMIT1 = [],
            PERMIT2 = [],
            SST = [],
            TOKEN = [],
            bakSECRET = [],
            SECRET = [],
            PERMIT = [],
            SEC = [],
            xID = [],
            xCID = [],
            X = [],
            Y = [],
            E = [],
            F = [],
            HCID = [],
            rHCID = [],
            HID = [],
            HTID = [],

            G1 = [],
            G2 = [],
            R = [],
            Z = [],
            W = [],
            T = [],
            CK = [],
            SK = [],

            sha = ctx.ECP.HASH_TYPE,

            IDstr = "testUser@miracl.com",
            pin = 1234,
            pin2 = 2345,
            CLIENT_ID, date;

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

            var RAW = [];
            rng.clean();
            for (var j = 0; j < 100; j++) RAW[j] = j;
            rng.seed(100, RAW);

            /* Trusted Authorities set-up */
            MPIN.RANDOM_GENERATE(rng, S1);
            MPIN.RANDOM_GENERATE(rng, S2);

            /* Create Client Identity */
            CLIENT_ID = MPIN.stringtobytes(IDstr);
            HCID = MPIN.HASH_ID(sha, CLIENT_ID); /* Either Client or TA calculates Hash(ID) - you decide! */
            ctx.ECP.mapit(HCID).toBytes(rHCID);

            /* Client and Server are issued secrets by the DTAs */
            MPIN.GET_SERVER_SECRET(S1, SST1);
            MPIN.GET_SERVER_SECRET(S2, SST2);
            MPIN.RECOMBINE_G2(SST1, SST2, SST);

            MPIN.GET_CLIENT_SECRET(S1, HCID, TOKEN1);
            MPIN.GET_CLIENT_SECRET(S2, HCID, TOKEN2);
            MPIN.RECOMBINE_G1(TOKEN1, TOKEN2, TOKEN);

            SECRET = TOKEN.slice();
            MPIN.EXTRACT_PIN(sha, CLIENT_ID, pin, TOKEN);
            MPIN.PRECOMPUTE(TOKEN, HCID, G1, G2);

            /* Client gets "Time Token" permit from DTA */
            date = MPIN.today();
            MPIN.GET_CLIENT_PERMIT(sha, date, S1, HCID, PERMIT1);
            MPIN.GET_CLIENT_PERMIT(sha, date, S2, HCID, PERMIT2);
            MPIN.RECOMBINE_G1(PERMIT1,PERMIT2,PERMIT);

            /* This encoding makes Time permit look random - Elligator squared */
            MPIN.ENCODING(rng, PERMIT);
            MPIN.DECODING(PERMIT);

            done();
        });

        it('test extract/restore factors', function(done) {
            bakSECRET = SECRET.slice();
            MPIN.EXTRACT_FACTOR(sha, CLIENT_ID, pin%MPIN.MAXPIN,MPIN.PBLEN,SECRET);
            MPIN.RESTORE_FACTOR(sha, CLIENT_ID, pin%MPIN.MAXPIN,MPIN.PBLEN,SECRET);
            expect(MPIN.comparebytes(SECRET,bakSECRET)).to.be.true;
            done();
        })

        it('test MPin (Full) One Pass', function(done) {
            this.timeout(0);

            date = 0;
            CK = [];
            SK = [];

            var pxID = xID;
            var pxCID = null;
            var pHID = HID;
            var pHTID = null;
            var pE = null;
            var pF = null;
            var pPERMIT = null;
            var prHID = HCID;

            timeValue = MPIN.GET_TIME();

            rtn = MPIN.CLIENT(sha, date, CLIENT_ID, rng, X, pin, TOKEN, SEC, pxID, pxCID, pPERMIT, timeValue, Y);
            expect(rtn).to.be.equal(0);

            MPIN.GET_G1_MULTIPLE(rng, 1, R, prHID, Z); /* Also Send Z=r.ID to Server, remember random r */

            rtn = MPIN.SERVER(sha, date, pHID, pHTID, Y, SST, pxID, pxCID, SEC, pE, pF, CLIENT_ID, timeValue);
            expect(rtn).to.be.equal(0);

            MPIN.GET_G1_MULTIPLE(rng, 1, W, prHID, T); /* Also send T=w.ID to client, remember random w  */

            H = MPIN.HASH_ALL(sha, prHID, pxID, pxCID, SEC, Y, Z, T);
            rtn = MPIN.CLIENT_KEY(sha, G1, G2, pin, R, X, H, T, CK);
            expect(rtn).to.be.equal(0);

            H = MPIN.HASH_ALL(sha, prHID, pxID, pxCID, SEC, Y, Z, T);
            rtn = MPIN.SERVER_KEY(sha, Z, SST, W, H, pHID, pxID, pxCID, SK);
            expect(rtn).to.be.equal(0);
            expect(MPIN.bytestostring(CK)).to.be.equal(MPIN.bytestostring(SK));
            done();
        });

        it('test MPin (Full) Two Pass', function(done) {
            this.timeout(0);

            /* Set configuration */
            date = 0;
            CK = [];
            SK = [];

            var pxID = xID;
            var pxCID = null;
            var pHID = HID;
            var pHTID = null;
            var pE = null;
            var pF = null;
            var pPERMIT = null;
            var prHID = rHCID;

            rtn = MPIN.CLIENT_1(sha, date, CLIENT_ID, rng, X, pin, TOKEN, SEC, pxID, pxCID, pPERMIT);
            expect(rtn).to.be.equal(0);

            rtn = MPIN.GET_G1_MULTIPLE(rng, 0, R, prHID, Z); /* Also Send Z=r.ID to Server, remember random r */
            expect(rtn).to.be.equal(0);

            /* Server calculates H(ID) and H(T|H(ID)) (if time permits enabled), and maps them to points on the curve HID and HTID resp. */
            MPIN.SERVER_1(sha, date, CLIENT_ID, pHID, pHTID);

            /* Server generates Random number Y and sends it to Client */
            MPIN.RANDOM_GENERATE(rng, Y);

            rtn = MPIN.GET_G1_MULTIPLE(rng, 0, W, prHID, T); /* Also send T=w.ID to client, remember random w  */
            expect(rtn).to.be.equal(0);

            /* Client Second Pass: Inputs Client secret SEC, x and y. Outputs -(x+y)*SEC */
            rtn = MPIN.CLIENT_2(X, Y, SEC);
            expect(rtn).to.be.equal(0);

            /* Server Second pass. Inputs hashed client id, random Y, -(x+y)*SEC, xID and xCID and Server secret SST. E and F help kangaroos to find error. */
            /* If PIN error not required, set E and F = NULL */
            rtn = MPIN.SERVER_2(date, pHID, pHTID, Y, SST, pxID, pxCID, SEC, pE, pF);
            expect(rtn).to.be.equal(0);

            H = MPIN.HASH_ALL(sha, prHID, pxID, pxCID, SEC, Y, Z, T);
            rtn = MPIN.CLIENT_KEY(sha, G1, G2, pin, R, X, H, T, CK);
            expect(rtn).to.be.equal(0);

            H = MPIN.HASH_ALL(sha, prHID, pxID, pxCID, SEC, Y, Z, T);
            MPIN.SERVER_KEY(sha, Z, SST, W, H, pHID, pxID, pxCID, SK);
            expect(MPIN.bytestostring(CK)).to.be.equal(MPIN.bytestostring(SK));
            expect(rtn).to.be.equal(0);

            done();
        });

        it('test MPin Time Permits', function(done) {
            this.timeout(0);

            date = MPIN.today();
            var pxID = null;
            var pxCID = xCID;
            var pHID = HID;
            var pHTID = HTID;
            var pPERMIT = PERMIT;

            rtn = MPIN.CLIENT_1(sha, date, CLIENT_ID, rng, X, pin, TOKEN, SEC, pxID, pxCID, pPERMIT);
            expect(rtn).to.be.equal(0);

            /* Server calculates H(ID) and H(T|H(ID)) (if time permits enabled), and maps them to points on the curve HID and HTID resp. */
            MPIN.SERVER_1(sha, date, CLIENT_ID, pHID, pHTID);

            /* Server generates Random number Y and sends it to Client */
            MPIN.RANDOM_GENERATE(rng, Y);

            /* Client Second Pass: Inputs Client secret SEC, x and y. Outputs -(x+y)*SEC */
            rtn = MPIN.CLIENT_2(X, Y, SEC);
            expect(rtn).to.be.equal(0);

            /* Server Second pass. Inputs hashed client id, random Y, -(x+y)*SEC, xID and xCID and Server secret SST. E and F help kangaroos to find error. */
            /* If PIN error not required, set E and F = NULL */
            rtn = MPIN.SERVER_2(date, pHID, pHTID, Y, SST, pxID, pxCID, SEC, null, null);
            expect(rtn).to.be.equal(0);

            done();

        });

      	it('test MPin bad PIN', function(done) {
            this.timeout(0);

            date = 0
            var pxID = xID;
            var pxCID = null;
            var pHID = HID;
            var pHTID = null;
            var pPERMIT = null;

            timeValue = MPIN.GET_TIME();

            rtn = MPIN.CLIENT(sha, date, CLIENT_ID, rng, X, pin2, TOKEN, SEC, pxID, pxCID, pPERMIT, timeValue, Y);
            expect(rtn).to.be.equal(0);

            rtn = MPIN.SERVER(sha, date, pHID, pHTID, Y, SST, pxID, pxCID, SEC, E, F, CLIENT_ID, timeValue);
            expect(rtn).to.be.equal(MPIN.BAD_PIN);

            done();
        });

        it('test MPin Kangaroo', function(done) {
            this.timeout(0);

            /* Retrieve PIN error from bad PIN test*/
            rtn = MPIN.KANGAROO(E,F);
            expect(rtn).to.be.equal(pin2-pin);

            done();
        });

        if (tv_curves.indexOf(curve) != -1) {

            var vectors = require('../testVectors/mpin/MPIN_' + curve + '.json');
            var sha = ctx.ECP.HASH_TYPE;
            var CS = [];
            var TP = [];
            var TP1bytes = [];
            var TP2bytes = [];
            var TPbytes = [];
            var CS1bytes = [];
            var CS2bytes = [];
            var CSbytes = [];

            it('test Combine Shares in G1 ' + curve + ' with Test Vectors', function(done) {
                this.timeout(0);

                vectors.forEach(function(vector) {
                    CS1bytes = hextobytes(vector.CS1);
                    CS2bytes = hextobytes(vector.CS2);
                    CSbytes = hextobytes(vector.CLIENT_SECRET);
                    MPIN.RECOMBINE_G1(CS1bytes, CS2bytes, CS);
                    expect(MPIN.comparebytes(CS,CSbytes)).to.be.equal(true);

                    TP1bytes = hextobytes(vector.TP1);
                    TP2bytes = hextobytes(vector.TP2);
                    TPbytes = hextobytes(vector.TIME_PERMIT);
                    MPIN.RECOMBINE_G1(TP1bytes, TP2bytes, TP);
                    expect(MPIN.comparebytes(TP,TPbytes)).to.be.equal(true);
                });

                done();
            });

            it('test MPin Two Passes ' + curve + ' with Test Vectors', function(done) {
                this.timeout(0);

                xID = [];
                xCID = [];
                SEC = [];
                Y = [];

                vectors.forEach(function(vector) {
                    var rtn = MPIN.CLIENT_1(sha, vector.DATE, hextobytes(vector.MPIN_ID_HEX), null, hextobytes(vector.X), vector.PIN2, hextobytes(vector.TOKEN), SEC, xID, xCID, hextobytes(vector.TIME_PERMIT));
                    expect(rtn).to.be.equal(0);
                    expect(MPIN.bytestostring(xID)).to.be.equal(vector.U);
                    expect(MPIN.bytestostring(xCID)).to.be.equal(vector.UT);

                    var rtn = MPIN.CLIENT_2(hextobytes(vector.X), hextobytes(vector.Y), SEC);
                    expect(rtn).to.be.equal(0);
                    expect(MPIN.bytestostring(SEC)).to.be.equal(vector.V);
                });

                done();
            });

            it('test MPin One Pass ' + curve + ' with Test Vectors', function(done) {
                this.timeout(0);

                xID = [];
                SEC = [];
                Y = [];

                vectors = require('../testVectors/mpin/MPIN_ONE_PASS_' + curve + '.json');

                vectors.forEach(function(vector) {
                    var rtn = MPIN.CLIENT(sha, 0, hextobytes(vector.MPIN_ID_HEX), null, hextobytes(vector.X), vector.PIN2, hextobytes(vector.TOKEN), SEC, xID, null, null, vector.TimeValue, Y);
                    expect(rtn).to.be.equal(0);
                    expect(MPIN.bytestostring(xID)).to.be.equal(vector.U);
                    expect(MPIN.bytestostring(SEC)).to.be.equal(vector.SEC);
                });

                done();
            });
        }
    });
});
