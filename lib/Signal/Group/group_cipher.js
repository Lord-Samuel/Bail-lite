import { decrypt, encrypt } from 'libsignal/src/crypto.js';
import { SenderKeyMessage } from './sender-key-message.js';
const MAX_FUTURE_MESSAGES = 2000;
export class GroupCipher {
    constructor(senderKeyStore, senderKeyName) {
        this.senderKeyStore = senderKeyStore;
        this.senderKeyName = senderKeyName;
    }
    async encrypt(paddedPlaintext) {
        const record = await this.senderKeyStore.loadSenderKey(this.senderKeyName);
        if (!record) {
            throw new Error('No SenderKeyRecord found for encryption');
        }
        const senderKeyState = record.getSenderKeyState();
        if (!senderKeyState) {
            throw new Error('No session to encrypt message');
        }
        // Use the chain's current iteration. The old `iteration === 0 ? 0 : iteration + 1` skipped a
        // counter on every send and pushed each skipped key into our own record (up to 2000 of them,
        // re-serialised on every group message).
        const senderKey = this.getSenderKey(senderKeyState, senderKeyState.getSenderChainKey().getIteration());
        const ciphertext = this.getCipherText(senderKey.getIv(), senderKey.getCipherKey(), paddedPlaintext);
        const senderKeyMessage = new SenderKeyMessage(senderKeyState.getKeyId(), senderKey.getIteration(), ciphertext, senderKeyState.getSigningKeyPrivate());
        await this.senderKeyStore.storeSenderKey(this.senderKeyName, record);
        return senderKeyMessage.serialize();
    }
    async decrypt(senderKeyMessageBytes) {
        const record = await this.senderKeyStore.loadSenderKey(this.senderKeyName);
        if (!record) {
            throw new Error('No SenderKeyRecord found for decryption');
        }
        const senderKeyMessage = new SenderKeyMessage(null, null, null, null, senderKeyMessageBytes);
        const senderKeyState = record.getSenderKeyState(senderKeyMessage.getKeyId());
        if (!senderKeyState) {
            throw new Error('No session found to decrypt message');
        }
        senderKeyMessage.verifySignature(senderKeyState.getSigningKeyPublic());
        const senderKey = this.getSenderKey(senderKeyState, senderKeyMessage.getIteration());
        const plaintext = this.getPlainText(senderKey.getIv(), senderKey.getCipherKey(), senderKeyMessage.getCipherText());
        await this.senderKeyStore.storeSenderKey(this.senderKeyName, record);
        return plaintext;
    }
    getSenderKey(senderKeyState, iteration) {
        let senderChainKey = senderKeyState.getSenderChainKey();
        if (senderChainKey.getIteration() > iteration) {
            const messageKey = senderKeyState.removeSenderMessageKey(iteration);
            if (messageKey) {
                return messageKey;
            }
            throw new Error(`Received message with old counter: ${senderChainKey.getIteration()}, ${iteration}`);
        }
        if (iteration - senderChainKey.getIteration() > MAX_FUTURE_MESSAGES) {
            throw new Error('Over 2000 messages into the future!');
        }
        while (senderChainKey.getIteration() < iteration) {
            senderKeyState.addSenderMessageKey(senderChainKey.getSenderMessageKey());
            senderChainKey = senderChainKey.getNext();
        }
        senderKeyState.setSenderChainKey(senderChainKey.getNext());
        return senderChainKey.getSenderMessageKey();
    }
    getPlainText(iv, key, ciphertext) {
        try {
            return decrypt(key, ciphertext, iv);
        }
        catch (e) {
            throw new Error('InvalidMessageException', { cause: e });
        }
    }
    getCipherText(iv, key, plaintext) {
        try {
            return encrypt(key, plaintext, iv);
        }
        catch (e) {
            throw new Error('InvalidMessageException', { cause: e });
        }
    }
}
