import { BufferJSON } from '../../Utils/generics.js';
import { SenderKeyState } from './sender-key-state.js';
const normalizePublicKey = (key) => {
    const buf = Buffer.from(key || []);
    if (buf.length === 32) {
        return Buffer.concat([Buffer.from([0x05]), buf]);
    }
    return buf;
};
const sameSigningKey = (a, b) => normalizePublicKey(a).equals(normalizePublicKey(b));
export class SenderKeyRecord {
    constructor(serialized) {
        this.MAX_STATES = 5;
        this.senderKeyStates = [];
        if (serialized) {
            for (const structure of serialized) {
                this.senderKeyStates.push(new SenderKeyState(null, null, null, null, null, null, structure));
            }
        }
    }
    isEmpty() {
        return this.senderKeyStates.length === 0;
    }
    getSenderKeyState(keyId) {
        if (keyId === undefined && this.senderKeyStates.length) {
            return this.senderKeyStates[this.senderKeyStates.length - 1];
        }
        return this.senderKeyStates.find(state => state.getKeyId() === keyId);
    }
    addSenderKeyState(id, iteration, chainKey, signatureKey) {
        // An SKDM for a key we already hold gets re-sent on retries. Pushing a duplicate burned one of
        // the MAX_STATES slots each time and could evict a still-needed older key. Keep the existing
        // state (it is further along and holds skipped message keys) and just mark it most recent.
        const existingIdx = this.senderKeyStates.findIndex(state => state.getKeyId() === id && sameSigningKey(state.getSigningKeyPublic(), signatureKey));
        if (existingIdx !== -1) {
            const [existing] = this.senderKeyStates.splice(existingIdx, 1);
            this.senderKeyStates.push(existing);
            return;
        }
        this.senderKeyStates.push(new SenderKeyState(id, iteration, chainKey, null, signatureKey));
        if (this.senderKeyStates.length > this.MAX_STATES) {
            this.senderKeyStates.shift();
        }
    }
    setSenderKeyState(id, iteration, chainKey, keyPair) {
        this.senderKeyStates.length = 0;
        this.senderKeyStates.push(new SenderKeyState(id, iteration, chainKey, keyPair));
    }
    serialize() {
        return this.senderKeyStates.map(state => state.getStructure());
    }
    static deserialize(data) {
        const str = Buffer.from(data).toString('utf-8');
        const parsed = JSON.parse(str, BufferJSON.reviver);
        return new SenderKeyRecord(parsed);
    }
}
