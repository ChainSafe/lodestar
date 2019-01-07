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

/* Test FP48 ARITHMETICS - test driver and function exerciser for FP4 API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var pf_curves = ['BLS48'];

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

var readFP8 = function(string, ctx) {
    var X, Y;

    string = string.split("]],[[");
    var cox = string[0].slice(1) + "]]";
    var coy = "[[" + string[1].slice(0,-1);

    X = readFP4(cox,ctx);
    Y = readFP4(coy,ctx);

    return new ctx.FP8(X,Y);
}

var readFP16 = function(string, ctx) {
    var X, Y;

    string = string.split("]]],[[[");
    var cox = string[0].slice(1) + "]]]";
    var coy = "[[[" + string[1].slice(0,-1);

    X = readFP8(cox,ctx);
    Y = readFP8(coy,ctx);

    return new ctx.FP16(X,Y);
}

var readFP48= function(string, ctx) {
    var X,Y,Z;

    string = string.split("]]]],[[[[");
    var cox = string[0].slice(1) + "]]]]";
    var coy = "[[[[" + string[1] + "]]]]";
    var coz = "[[[[" + string[2].slice(0,-1);

    X = readFP16(cox,ctx);
    Y = readFP16(coy,ctx);
    Z = readFP16(coz,ctx);

    return new ctx.FP48(X,Y,Z);
}

describe('TEST FP48 ARITHMETIC', function() {

    pf_curves.forEach(function(curve){

        it('test '+ curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/fp48/'+ curve +'.json');
            var i = 0;

            var Fra = new ctx.FP(0),
                Frb = new ctx.FP(0),
                Fr;
            Fra.rcopy(ctx.ROM_FIELD.Fra);
            Frb.rcopy(ctx.ROM_FIELD.Frb);
            Fr = new ctx.FP2(Fra,Frb);

            vectors.forEach(function(vector) {
                var fp481,fp482,fp48c;
                fp481 = readFP48(vector.FP481, ctx);
                fp482 = readFP48(vector.FP482, ctx);
                fp48c = readFP48(vector.FP48c, ctx);

                // Generate/read the necessary FP48 and BIGs
                var fp48frobs = [fp481];
                if(i===0){
                    for (k=1; k<16; k++) {
                        var t = new ctx.FP48(0);
                        t.copy(fp48frobs[k-1]);
                        t.frob(Fr,1);
                        fp48frobs[k] = t;
                    }
                } else {
                    var t = new ctx.FP48(0);
                    t.copy(fp481);
                    t.frob(Fr,1);
                    fp48frobs[1] = t;
                }

                var BIGsc = [],
                    BIGscs,
                    BIGsco,
                    k;
                if (i === 0) {
                    for (k=1; k<=16; k++) {
                        BIGsc[k-1] = readBIG(vector["BIGsc" + k], ctx);
                    }
                } else {
                    BIGsc[0] = readBIG(vector.BIGsc1, ctx);
                }
                BIGscs = readBIG(vector.BIGscs, ctx);
                BIGsco = readBIG(vector.BIGsco, ctx);

                var a1 = new ctx.FP48(0);
                var a2 = new ctx.FP48(0);

                // test conjugate of a FP4
                var fp48conj = readFP48(vector.FP48conj, ctx);
                a1.copy(fp481);
                a1.conj();
                expect(a1.toString()).to.equal(fp48conj.toString());

                // test multiplication and commutativity
                var fp48mul = readFP48(vector.FP48mul, ctx);
                a1.copy(fp481);
                a2.copy(fp482);
                a1.mul(fp482);
                a2.mul(fp481);
                expect(a1.toString()).to.equal(fp48mul.toString());
                expect(a2.toString()).to.equal(fp48mul.toString());

                // test square
                var fp48sqr = readFP48(vector.FP48square, ctx);
                a1.copy(fp481);
                a1.sqr();
                expect(a1.toString()).to.equal(fp48sqr.toString());

                // test unitary square
                var fp48usqr = readFP48(vector.FP48usquare, ctx);
                a1.copy(fp481);
                a1.usqr();
                expect(a1.toString()).to.equal(fp48usqr.toString());

                // test inverse
                var fp48inv = readFP48(vector.FP48inv, ctx);
                a1.copy(fp481);
                a1.inverse();
                expect(a1.toString()).to.equal(fp48inv.toString());

                // test smultiplication for D-TYPE
                var fp48smulydtype = readFP48(vector.FP48smulydtype,ctx);
                var fp48smuldtype = readFP48(vector.FP48smuldtype,ctx);
                a1.copy(fp481);
                a1.smul(fp48smulydtype, ctx.ECP.D_TYPE);
                expect(a1.toString()).to.equal(fp48smuldtype.toString());

                // test smultiplication for M-TYPE
                var fp48smulymtype = readFP48(vector.FP48smulymtype,ctx);
                var fp48smulmtype = readFP48(vector.FP48smulmtype,ctx);
                a1.copy(fp481);
                a1.smul(fp48smulymtype, ctx.ECP.M_TYPE);
                expect(a1.toString()).to.equal(fp48smulmtype.toString());

                // test power
                var fp48pow = readFP48(vector.FP48pow, ctx);
                a1 = fp481.pow(BIGsc[0]);
                expect(a1.toString()).to.equal(fp48pow.toString());

                // test power by small integer
                var fp48pinpow = readFP48(vector.FP48pinpow, ctx);
                a1.copy(fp481);
                a1.pinpow(i+1,10);
                expect(a1.toString()).to.equal(fp48pinpow.toString());
                i++;

                // test compressed power with big integer
                var fp48compow = readFP16(vector.FP48compow, ctx);
                a1 = fp48c.compow(BIGsc[0],BIGsco);
                expect(a1.toString()).to.equal(fp48compow.toString());

                // test compressed power with small integer
                var fp48compows = readFP16(vector.FP48compows, ctx);
                a1 = fp48c.compow(BIGscs,BIGsco);
                expect(a1.toString()).to.equal(fp48compows.toString());

                // test pow16
                // Tested only once for timing reasons
                if (i===0) {
                    var fp48pow16 = readFP48(vector.FP48pow16, ctx);
                    a1 = ctx.FP48.pow16(fp48frobs,BIGsc);
                    expect(a1.toString()).to.equal(fp48pow16.toString());
                }

                // test frobenius
                var fp48frob = readFP48(vector.FP48frob, ctx);
                expect(fp48frobs[1].toString()).to.equal(fp48frob.toString());

                //test trace
                var fp16trace = readFP16(vector.FP16trace, ctx);
                a1 = fp481.trace();
                expect(a1.toString()).to.equal(fp16trace.toString());
            });
            done();
        });
    });
});
