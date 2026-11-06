import { calculateSignature, verifySignature } from 'libsignal/src/curve.js';
import { proto } from '../../../WAProto/index.js';
import { CiphertextMessage } from './ciphertext-message.js';
export class SenderKeyMessage extends CiphertextMessage {
    constructor(keyId, iteration, ciphertext, signatureKey, serialized) {
        super();
        this.SIGNATURE_LENGTH = 64;
        if (serialized) {
            // 1 version byte + payload + 64 byte signature; anything shorter is malformed
            if (serialized.length <= this.SIGNATURE_LENGTH + 1) {
                throw new Error('Invalid sender key message: too short');
            }
            const version = serialized[0];
            const message = serialized.slice(1, serialized.length - this.SIGNATURE_LENGTH);
            const signature = serialized.slice(-1 * this.SIGNATURE_LENGTH);
            // decode directly: toJSON() base64-encoded the ciphertext only to decode it again, on every
            // group message. Absent id/iteration are proto defaults (0); previously they became
            // `undefined`, and getSenderKeyState(undefined) silently selects the *latest* state.
            const senderKeyMessage = proto.SenderKeyMessage.decode(message);
            if (!senderKeyMessage.ciphertext) {
                throw new Error('Invalid sender key message: missing ciphertext');
            }
            this.serialized = serialized;
            this.messageVersion = (version & 0xff) >> 4;
            this.keyId = senderKeyMessage.id ?? 0;
            this.iteration = senderKeyMessage.iteration ?? 0;
            this.ciphertext = Buffer.isBuffer(senderKeyMessage.ciphertext)
                ? senderKeyMessage.ciphertext
                : Buffer.from(senderKeyMessage.ciphertext);
            this.signature = signature;
        }
        else {
            const version = (((this.CURRENT_VERSION << 4) | this.CURRENT_VERSION) & 0xff) % 256;
            const ciphertextBuffer = Buffer.from(ciphertext);
            const message = proto.SenderKeyMessage.encode(proto.SenderKeyMessage.create({
                id: keyId,
                iteration: iteration,
                ciphertext: ciphertextBuffer
            })).finish();
            const signature = this.getSignature(signatureKey, Buffer.concat([Buffer.from([version]), message]));
            this.serialized = Buffer.concat([Buffer.from([version]), message, Buffer.from(signature)]);
            this.messageVersion = this.CURRENT_VERSION;
            this.keyId = keyId;
            this.iteration = iteration;
            this.ciphertext = ciphertextBuffer;
            this.signature = signature;
        }
    }
    getKeyId() {
        return this.keyId;
    }
    getIteration() {
        return this.iteration;
    }
    getCipherText() {
        return this.ciphertext;
    }
    verifySignature(signatureKey) {
        const part1 = this.serialized.slice(0, this.serialized.length - this.SIGNATURE_LENGTH);
        const part2 = this.serialized.slice(-1 * this.SIGNATURE_LENGTH);
        const res = verifySignature(signatureKey, part1, part2);
        if (!res)
            throw new Error('Invalid signature!');
    }
    getSignature(signatureKey, serialized) {
        return Buffer.from(calculateSignature(signatureKey, serialized));
    }
    serialize() {
        return this.serialized;
    }
    getType() {
        return 4;
    }
}
