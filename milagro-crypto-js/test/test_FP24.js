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


/* Test FP24 ARITHMETICS - test driver and function exerciser for FP4 API Functions */

var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var pf_curves = ['BLS24'];

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

var readFP24= function(string, ctx) {
    var X,Y,Z;

    string = string.split("]]],[[[");
    var cox = string[0].slice(1) + "]]]";
    var coy = "[[[" + string[1] + "]]]";
    var coz = "[[[" + string[2].slice(0,-1);

    X = readFP8(cox,ctx);
    Y = readFP8(coy,ctx);
    Z = readFP8(coz,ctx);

    return new ctx.FP24(X,Y,Z);
}


describe('TEST FP24 ARITHMETIC', function() {

    pf_curves.forEach(function(curve){

        it('test '+ curve, function(done) {
            this.timeout(0);

            var ctx = new CTX(curve);
            var vectors = require('../testVectors/fp24/'+ curve +'.json');
            var i = 0;

            var Fra = new ctx.FP(0),
                Frb = new ctx.FP(0),
                Fr;
            Fra.rcopy(ctx.ROM_FIELD.Fra);
            Frb.rcopy(ctx.ROM_FIELD.Frb);
            Fr = new ctx.FP2(Fra,Frb);

            vectors.forEach(function(vector) {
                var fp241,fp242,fp24c;
                fp241 = readFP24(vector.FP241, ctx);
                fp242 = readFP24(vector.FP242, ctx);
                fp24c = readFP24(vector.FP24c, ctx);

                // Generate/read the necessary FP24 and BIGs
                var fp24frobs = [fp241];
                if(i===0){
                    for (k=1; k<8; k++) {
                        var t = new ctx.FP24(0);
                        t.copy(fp24frobs[k-1]);
                        t.frob(Fr,1);
                        fp24frobs[k] = t;
                    }
                } else {
                    var t = new ctx.FP24(0);
                    t.copy(fp241);
                    t.frob(Fr,1);
                    fp24frobs[1] = t;
                }

                var BIGsc = [],
                    BIGscs,
                    BIGsco,
                    k;
                if (i === 0) {
                    for (k=1; k<=8; k++) {
                        BIGsc[k-1] = readBIG(vector["BIGsc" + k], ctx);
                    }
                } else {
                    BIGsc[0] = readBIG(vector.BIGsc1, ctx);
                }
                BIGscs = readBIG(vector.BIGscs, ctx);
                BIGsco = readBIG(vector.BIGsco, ctx);

                var a1 = new ctx.FP24(0);
                var a2 = new ctx.FP24(0);

                // test conjugate of a FP4
                var fp24conj = readFP24(vector.FP24conj, ctx);
                a1.copy(fp241);
                a1.conj();
                expect(a1.toString()).to.equal(fp24conj.toString());

                // test multiplication and commutativity
                var fp24mul = readFP24(vector.FP24mul, ctx);
                a1.copy(fp241);
                a2.copy(fp242);
                a1.mul(fp242);
                a2.mul(fp241);
                expect(a1.toString()).to.equal(fp24mul.toString());
                expect(a2.toString()).to.equal(fp24mul.toString());

                // test square
                var fp24sqr = readFP24(vector.FP24square, ctx);
                a1.copy(fp241);
                a1.sqr();
                expect(a1.toString()).to.equal(fp24sqr.toString());

                // test unitary square
                var fp24usqr = readFP24(vector.FP24usquare, ctx);
                a1.copy(fp241);
                a1.usqr();
                expect(a1.toString()).to.equal(fp24usqr.toString());

                // test inverse
                var fp24inv = readFP24(vector.FP24inv, ctx);
                a1.copy(fp241);
                a1.inverse();
                expect(a1.toString()).to.equal(fp24inv.toString());

                // test smultiplication for D-TYPE
                var fp24smulydtype = readFP24(vector.FP24smulydtype,ctx);
                var fp24smuldtype = readFP24(vector.FP24smuldtype,ctx);
                a1.copy(fp241);
                a1.smul(fp24smulydtype, ctx.ECP.D_TYPE);
                expect(a1.toString()).to.equal(fp24smuldtype.toString());

                // test smultiplication for M-TYPE
                var fp24smulymtype = readFP24(vector.FP24smulymtype,ctx);
                var fp24smulmtype = readFP24(vector.FP24smulmtype,ctx);
                a1.copy(fp241);
                a1.smul(fp24smulymtype, ctx.ECP.M_TYPE);
                expect(a1.toString()).to.equal(fp24smulmtype.toString());

                // test power
                var fp24pow = readFP24(vector.FP24pow, ctx);
                a1 = fp241.pow(BIGsc[0]);
                expect(a1.toString()).to.equal(fp24pow.toString());

                // test power by small integer
                var fp24pinpow = readFP24(vector.FP24pinpow, ctx);
                a1.copy(fp241);
                a1.pinpow(i+1,10);
                expect(a1.toString()).to.equal(fp24pinpow.toString());
                i++;

                // test compressed power with big integer
                var fp24compow = readFP8(vector.FP24compow, ctx);
                a1 = fp24c.compow(BIGsc[0],BIGsco);
                expect(a1.toString()).to.equal(fp24compow.toString());

                // test compressed power with small integer
                var fp24compows = readFP8(vector.FP24compows, ctx);
                a1 = fp24c.compow(BIGscs,BIGsco);
                expect(a1.toString()).to.equal(fp24compows.toString());

                // test pow8
                // tested only once for timing reasons
                if (i===0) {
                    var fp24pow8 = readFP24(vector.FP24pow8, ctx);
                    a1 = ctx.FP24.pow8(fp24frobs,BIGsc);
                    expect(a1.toString()).to.equal(fp24pow8.toString());
                }

                // test frobenius
                var fp24frob = readFP24(vector.FP24frob, ctx);
                expect(fp24frobs[1].toString()).to.equal(fp24frob.toString());

                //test trace
                var fp8trace = readFP8(vector.FP8trace, ctx);
                a1 = fp241.trace();
                expect(a1.toString()).to.equal(fp8trace.toString());
            });
            done();
        });
    });
});
