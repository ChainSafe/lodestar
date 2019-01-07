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


/* Test FP12 ARITHMETICS - test driver and function exerciser for FP4 API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var pf_curves = ['BN254', 'BN254CX', 'BLS381', 'BLS383', 'BLS461', 'FP256BN', 'FP512BN'];

var readBIG = function(string, ctx) {
    while (string.length != ctx.BIG.MODBYTES*2){string = "00"+string;}
    return ctx.BIG.fromBytes(Buffer.from(string, "hex"));
}

var readFP2 = function(string, ctx) {
    string = string.split(",");
    var cox = string[0].slice(1);
    var coy = string[1].slice(0,-1);

    var x = readBIG(cox,ctx);
    var y = readBIG(coy,ctx);

    return new ctx.FP2(x,y);;
}

var readFP4 = function(string, ctx) {
    var X, Y;

    string = string.split("],[");
    var cox = string[0].slice(1) + "]";
    var coy = "[" + string[1].slice(0,-1);

    X = readFP2(cox,ctx);
    Y = readFP2(coy,ctx);

    return new ctx.FP4(X,Y);
}

var readFP12= function(string, ctx) {
    var X,Y,Z;

    string = string.split("]],[[");
    var cox = string[0].slice(1) + "]]";
    var coy = "[[" + string[1] + "]]";
    var coz = "[[" + string[2].slice(0,-1);

    X = readFP4(cox,ctx);
    Y = readFP4(coy,ctx);
    Z = readFP4(coz,ctx);

    return new ctx.FP12(X,Y,Z);
}

describe('TEST FP12 ARITHMETIC', function() {

    pf_curves.forEach(function(curve){

        it('test '+ curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/fp12/'+ curve +'.json');

            var Fra = new ctx.FP(0),
                Frb = new ctx.FP(0),
                Fr;
            Fra.rcopy(ctx.ROM_FIELD.Fra);
            Frb.rcopy(ctx.ROM_FIELD.Frb);
            Fr = new ctx.FP2(Fra,Frb);

            var i = 0;
            vectors.forEach(function(vector) {
                // Generate/read the necessary FP12 and BIGs
                var fp121,fp122,fp123,fp124,fp12c;
                fp121 = readFP12(vector.FP121, ctx);
                fp122 = readFP12(vector.FP122, ctx);
                if (i===0){
                    fp123 = readFP12(vector.FP123, ctx);
                    fp124 = readFP12(vector.FP124, ctx);
                }
                    fp12c = readFP12(vector.FP12c, ctx);
                var BIGsc1,BIGsc2,BIGsc3,BIGsc4,BIGscs,BIGsco;
                BIGsc1 = readBIG(vector.BIGsc1, ctx);
                if (i===0){
                    BIGsc2 = readBIG(vector.BIGsc2, ctx);
                    BIGsc3 = readBIG(vector.BIGsc3, ctx);
                    BIGsc4 = readBIG(vector.BIGsc4, ctx);
                }
                BIGscs = readBIG(vector.BIGscs, ctx);
                BIGsco = readBIG(vector.BIGsco, ctx);
                var a1 = new ctx.FP12(0);
                var a2 = new ctx.FP12(0);

                // test conjugate of a FP4
                var fp12conj = readFP12(vector.FP12conj, ctx);
                a1.copy(fp121);
                a1.conj();
                expect(a1.toString()).to.equal(fp12conj.toString());

                // test multiplication and commutativity
                var fp12mul = readFP12(vector.FP12mul, ctx);
                a1.copy(fp121);
                a2.copy(fp122);
                a1.mul(fp122);
                a2.mul(fp121);
                expect(a1.toString()).to.equal(fp12mul.toString());
                expect(a2.toString()).to.equal(fp12mul.toString());

                // test square
                var fp12sqr = readFP12(vector.FP12square, ctx);
                a1.copy(fp121);
                a1.sqr();
                expect(a1.toString()).to.equal(fp12sqr.toString());

                // test unitary square
                var fp12usqr = readFP12(vector.FP12usquare, ctx);
                a1.copy(fp121);
                a1.usqr();
                expect(a1.toString()).to.equal(fp12usqr.toString());

                // test inverse
                var fp12inv = readFP12(vector.FP12inv, ctx);
                a1.copy(fp121);
                a1.inverse();
                expect(a1.toString()).to.equal(fp12inv.toString());

                // test smultiplication for D-TYPE
                var fp12smulydtype = readFP12(vector.FP12smulydtype,ctx);
                var fp12smuldtype = readFP12(vector.FP12smuldtype,ctx);
                a1.copy(fp121);
                a1.smul(fp12smulydtype, ctx.ECP.D_TYPE);
                expect(a1.toString()).to.equal(fp12smuldtype.toString());

                // test smultiplication for M-TYPE
                var fp12smulymtype = readFP12(vector.FP12smulymtype,ctx);
                var fp12smulmtype = readFP12(vector.FP12smulmtype,ctx);
                a1.copy(fp121);
                a1.smul(fp12smulymtype, ctx.ECP.M_TYPE);
                expect(a1.toString()).to.equal(fp12smulmtype.toString());

                // test power
                var fp12pow = readFP12(vector.FP12pow, ctx);
                a1 = fp121.pow(BIGsc1);
                expect(a1.toString()).to.equal(fp12pow.toString());

                // test power by small integer
                var fp12pinpow = readFP12(vector.FP12pinpow, ctx);
                a1.copy(fp121);
                a1.pinpow(i+1,10);
                expect(a1.toString()).to.equal(fp12pinpow.toString());
                i++;

                // test frobenius
                var fp12frob = readFP12(vector.FP12frob, ctx);
                a1.copy(fp121);
                a1.frob(Fr);
                expect(a1.toString()).to.equal(fp12frob.toString());

                // test compressed power with big integer
                var fp12compow = readFP4(vector.FP12compow, ctx);
                a1 = fp12c.compow(BIGsc1,BIGsco);
                expect(a1.toString()).to.equal(fp12compow.toString());

                // test compressed power with small integer
                var fp12compows = readFP4(vector.FP12compows, ctx);
                a1 = fp12c.compow(BIGscs,BIGsco);
                expect(a1.toString()).to.equal(fp12compows.toString());

                // test pow4
                // Executed only once for timing reasons
                if (i===0) {
                    var fp12pow4 = readFP12(vector.FP12pow4, ctx);
                    a1 = ctx.FP12.pow4([fp121,fp122,fp123,fp124],[BIGsc1,BIGsc2,BIGsc3,BIGsc4]);
                    expect(a1.toString()).to.equal(fp12pow4.toString());
                }

                //test trace
                var fp4trace = readFP4(vector.FP4trace, ctx);
                a1 = fp121.trace();
                expect(a1.toString()).to.equal(fp4trace.toString());
            });
            done();
        });
    });
});
