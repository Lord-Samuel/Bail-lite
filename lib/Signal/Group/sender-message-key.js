import { deriveSecrets } from 'libsignal/src/crypto.js';
const HKDF_SALT = Buffer.alloc(32);
const HKDF_INFO = Buffer.from('WhisperGroup');
export class SenderMessageKey {
    constructor(iteration, seed) {
        this.iteration = iteration;
        this.seed = seed;
        // iv / cipherKey are derived lazily: skipped-over iterations only ever need the seed stored,
        // and eagerly running HKDF for each of up to 2000 skipped keys was pure waste
        this.iv = undefined;
        this.cipherKey = undefined;
    }
    derive() {
        const derivative = deriveSecrets(this.seed, HKDF_SALT, HKDF_INFO);
        this.iv = Buffer.from(derivative[0].subarray(0, 16));
        this.cipherKey = Buffer.concat([derivative[0].subarray(16), derivative[1].subarray(0, 16)]);
    }
    getIteration() {
        return this.iteration;
    }
    getIv() {
        if (!this.iv)
            this.derive();
        return this.iv;
    }
    getCipherKey() {
        if (!this.cipherKey)
            this.derive();
        return this.cipherKey;
    }
    getSeed() {
        return this.seed;
    }
}
