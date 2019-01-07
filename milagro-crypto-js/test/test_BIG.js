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


/* Test BIG consistency - test driver and function exerciser for BIG API Functions */
var chai = require('chai');

var CTX = require("../index");

var expect = chai.expect;

var all_curves = ['ED25519', 'GOLDILOCKS', 'NIST256', 'BRAINPOOL', 'ANSSI', 'HIFIVE', 'C25519', 'SECP256K1', 'NIST384', 'C41417', 'NIST521', 'NUMS256W', 'NUMS256E', 'NUMS384W', 'NUMS384E', 'NUMS512W', 'NUMS512E', 'BN254', 'BN254CX', 'BLS381', 'BLS383', 'BLS461', 'FP256BN', 'FP512BN', 'BLS24', 'BLS48'];

var vectors = require('../testVectors/big/BIG.json');

var readBIG = function(string, ctx) {
    while (string.length != ctx.BIG.MODBYTES*2) string = "00"+string;
    return ctx.BIG.fromBytes(Buffer.from(string, "hex"));
}

var readDBIG = function(string, ctx) {
    var dh = new ctx.DBIG(0),
    	du = new ctx.DBIG(0),
    	arr,h,u;

    while (string.length != ctx.BIG.MODBYTES*4) string = "00"+string;
   	arr = Buffer.from(string, "hex");

   	u = ctx.BIG.fromBytes(arr);
   	h = ctx.BIG.frombytearray(arr,ctx.BIG.MODBYTES);

   	du.hcopy(u);
   	du.shl(ctx.BIG.MODBYTES * 8);
   	dh.hcopy(h);
	dh.add(du);

   	return dh;
}

all_curves.forEach(function(curve){

    var ctx = new CTX(curve),
    	rng = new ctx.RAND();

    describe('TEST BIG CONSISTENCY ' + curve, function() {

        before(function(done) {
            var RAW = [];
            rng.clean();
            for (i = 0; i < 100; i++) RAW[i] = i;
            rng.seed(100, RAW);
            done();
        });

        it('test set BIGs to zero, detect and compare them', function(done) {
            var F = new ctx.BIG(0),
                G = new ctx.BIG(1);

            G.zero();

            expect(F.iszilch()).to.be.equal(true);
            expect(G.iszilch()).to.be.equal(true);
            expect(ctx.BIG.comp(F,G)).to.be.equal(0);

            done();
        });

        it('test set DBIGs to zero, detect and compare them', function(done) {
            var F = new ctx.DBIG(0),
                G = new ctx.DBIG(1);

            G.zero();
            expect(ctx.DBIG.comp(F,G)).to.be.equal(0);

            done();
        });

        it('test copy a BIG and a DBIG', function(done) {
            var F = ctx.BIG.random(rng),
                G = new ctx.BIG(1);

            G.copy(F);

            expect(ctx.BIG.comp(F,G)).to.be.equal(0);

            F = new ctx.DBIG(0);
            G = new ctx.DBIG(0);

            F.hcopy(ctx.BIG.random(rng)),
            G.copy(F);

            expect(ctx.DBIG.comp(F,G)).to.be.equal(0);

            done();
        });

        it('test add/sub consistency', function(done) {
            var F = ctx.BIG.random(rng),
                G = ctx.BIG.random(rng),
                H = new ctx.BIG(0);

            H.copy(F);
            H.add(G);
            H.sub(G);

            expect(F.toString()).to.be.equal(H.toString());

            F.sub(F);

            expect(F.iszilch()).to.be.equal(true);

            F.zero();
            F.add(F);

            expect(F.iszilch()).to.be.equal(true);

            G.one();
            F.add(G);
            H.zero()
            G.add(H);
            H.one();

            expect(F.toString()).to.be.equal(H.toString());
            expect(H.toString()).to.be.equal(G.toString());

            done();
        });

        it('test imul/div3 consistency', function(done) {
            var F = ctx.BIG.random(rng),
                G = new ctx.BIG(0);

            G.copy(F);
            G.imul(3);
            G.div3();

            expect(ctx.DBIG.comp(F,G)).to.be.equal(0);

            done();
        });

        it('test imul/add consistency', function(done) {
            var F = ctx.BIG.random(rng),
                G = new ctx.BIG(0),
                H = new ctx.BIG(0);

            for(var i=0; i<20;i++) {
                G.zero();
                for(var j=0;j<i;j++){
                    G.add(F);
                }
                H.copy(F);
                H.imul(i);

                expect(H.toString()).to.be.equal(G.toString());
            }

            done();
        });

        it('test mul/sqr consistency', function(done) {
            var F = ctx.BIG.random(rng),
                G = new ctx.BIG(0);

            G = ctx.BIG.sqr(F);
            F = ctx.BIG.mul(F,F);

            expect(F.toString()).to.be.equal(G.toString());

            done();
        });

        it('test modsqr/sqr-mod consistency', function(done) {
            var F = ctx.BIG.random(rng),
                G = ctx.BIG.random(rng),
                H;

            H = ctx.BIG.sqr(F);
            H = H.mod(G);
            F = ctx.BIG.modsqr(F,G);

            expect(F.toString()).to.be.equal(H.toString());

            done();
        });

        it('test toBytes/fromBytes consistency', function(done) {
        	var F = ctx.BIG.random(rng);
        		G = new ctx.BIG(0),
        		arr = [];

        	G.copy(F);
        	G.toBytes(arr);
        	G = ctx.BIG.fromBytes(arr);

            expect(F.toString()).to.be.equal(G.toString());

            done();
        });

        it('test inc/dec consistency', function(done) {
            var F = ctx.BIG.random(rng),
                G = new ctx.BIG(0);

            G.copy(F);
            for(var i=0; i<20;i++) {
            	G.inc(i);
            	G.dec(i);

                expect(F.toString()).to.be.equal(G.toString());
            }

            done();
        });
    });

	describe('TEST BIG ARITHMETICS ' + curve, function() {

        before(function(done) {
            var RAW = [];
            rng.clean();
            for (i = 0; i < 100; i++) RAW[i] = i;
            rng.seed(100, RAW);
            done();
        });

		it('test comparison', function(done) {
			vectors.forEach(function(vector) {
				var BIG1 = readBIG(vector.BIG1,ctx),
					BIG2 = readBIG(vector.BIG2,ctx);

                expect(ctx.BIG.comp(BIG1,BIG2)).to.be.at.least(0);
			});

			done();
		});

		it('test sum', function(done) {
			vectors.forEach(function(vector) {
				var BIG1 = readBIG(vector.BIG1,ctx),
					BIG2 = readBIG(vector.BIG2,ctx),
					BIGsum = readBIG(vector.BIGsum,ctx);

				BIG1.add(BIG2);
                expect(BIG1.toString()).to.be.equal(BIGsum.toString());
			});

			done();
		});

		it('test subtraction', function(done) {
			vectors.forEach(function(vector) {
				var BIG1 = readBIG(vector.BIG1,ctx),
					BIG2 = readBIG(vector.BIG2,ctx),
					BIGsub = readBIG(vector.BIGsub,ctx);

				BIG1.sub(BIG2);
                expect(BIG1.toString()).to.be.equal(BIGsub.toString());
			});

			done();
		});

		it('test modulus this > m', function(done) {
			vectors.forEach(function(vector) {
				if(vectors.BIGmod2 !== undefined){
					var BIG1 = readBIG(vector.BIG1,ctx),
						BIG2 = readBIG(vector.BIG2,ctx),
						BIGmod2 = readBIG(vector.BIGmod1,ctx);

					BIG1.mod(BIG2);
					expect(BIG1.toString()).to.be.equal(BIGmod2.toString());
				}
			});

			done();
		});

		it('test modulus this < m', function(done) {
			vectors.forEach(function(vector) {
				if(vectors.BIGmod1 !== undefined){
					var BIG1 = readBIG(vector.BIG1,ctx),
						BIG2 = readBIG(vector.BIG2,ctx),
						BIGmod1 = readBIG(vector.BIGmod1,ctx);

					BIG2.mod(BIG1);
					expect(BIG2.toString()).to.be.equal(BIGmod1.toString());
				}
			});

			done();
		});

		it('test multiplication', function(done) {
			vectors.forEach(function(vector) {
				var BIG1 = readBIG(vector.BIG1,ctx),
					BIG2 = readBIG(vector.BIG2,ctx),
					BIGmul = readDBIG(vector.BIGmul,ctx);

				BIG1 = ctx.BIG.mul(BIG1, BIG2);
				expect(BIG1.toString()).to.be.equal(BIGmul.toString());
			});

			done();
		});

		it('test square', function(done) {
			vectors.forEach(function(vector) {
				var BIG1 = readBIG(vector.BIG1,ctx),
					BIG2 = readBIG(vector.BIG2,ctx),
					BIG1sqr = readDBIG(vector.BIG1sqr,ctx),
					BIG2sqr = readDBIG(vector.BIG2sqr,ctx);

				BIG1 = ctx.BIG.sqr(BIG1);
				BIG2 = ctx.BIG.sqr(BIG2);
				expect(BIG1.toString()).to.be.equal(BIG1sqr.toString());
				expect(BIG2.toString()).to.be.equal(BIG2sqr.toString());
			});

			done();
		});

		it('test modular square', function(done) {
			vectors.forEach(function(vector) {
				if(vectors.BIG1sqrmod2 !== undefined){
					var BIG1 = readBIG(vector.BIG1,ctx),
						BIG2 = readBIG(vector.BIG2,ctx),
						BIG1sqrmod2 = readBIG(vector.BIG1sqrmod2,ctx);

					BIG1.modsqr(BIG2);
					expect(BIG1.toString()).to.be.equal(BIG1sqrmod2.toString());
				}
			});

			done();
		});

		it('test modular negative', function(done) {
			vectors.forEach(function(vector) {
				if(vectors.BIG1modneg2 !== undefined){
					var BIG1 = readBIG(vector.BIG1,ctx),
						BIGmul = readBIG(vector.BIGmul,ctx),
						BIG1modneg2 = readBIG(vector.BIG1modneg2,ctx);

					BIG1.modneg(BIG2);
					expect(BIG1.toString()).to.be.equal(BIG1modneg2.toString());
				}
			});

			done();
		});

		it('test nbit BIG/DBIG', function(done) {
			vectors.forEach(function(vector) {
				var BIG1 = readBIG(vector.BIG1,ctx),
					BIGmul = readDBIG(vector.BIGmul,ctx),
					nbitBIG = vector.nbitBIG,
					nbitDBIG = vector.nbitDBIG;

				expect(BIG1.nbits()).to.be.equal(nbitBIG);
				expect(BIGmul.nbits()).to.be.equal(nbitDBIG);
			});

			done();
		});

		it('test DBIG division', function(done) {
			vectors.forEach(function(vector) {
				if(vectors.BIG1sqrmod2 !== undefined){
					var BIG1 = readDBIG(vector.BIGmul,ctx),
						BIG2 = readBIG(vector.BIGsum,ctx),
						BIGdiv = readBIG(vector.BIGdiv,ctx);

					BIG1 = BIG1.div(BIG2);
					expect(BIG1.toString()).to.be.equal(BIGdiv.toString());
				}
			});

			done();
		});

		it('test invmodp and modmul', function(done) {
			var mod = readBIG("E186EB30EF",ctx),
				div = readBIG("0ED5066C6815047425DF",ctx),
				BIG1;

			div.invmodp(mod);
			vectors.forEach(function(vector) {
				BIG1 = readBIG(vector.BIG1,ctx);
				BIGdivmod = readDBIG(vector.BIGdivmod,ctx);

				BIG1 = ctx.BIG.modmul(BIG1, div, mod);

				expect(ctx.BIG.comp(BIG1,BIGdivmod)).to.be.equal(0);
			});

			done();
		});
	});
});
