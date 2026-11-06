import * as keyhelper from './keyhelper.js';
import { SenderKeyDistributionMessage } from './sender-key-distribution-message.js';
import { SenderKeyRecord } from './sender-key-record.js';
export class GroupSessionBuilder {
    constructor(senderKeyStore) {
        this.senderKeyStore = senderKeyStore;
    }
    async process(senderKeyName, senderKeyDistributionMessage) {
        const senderKeyRecord = (await this.senderKeyStore.loadSenderKey(senderKeyName)) ?? new SenderKeyRecord();
        senderKeyRecord.addSenderKeyState(senderKeyDistributionMessage.getId(), senderKeyDistributionMessage.getIteration(), senderKeyDistributionMessage.getChainKey(), senderKeyDistributionMessage.getSignatureKey());
        await this.senderKeyStore.storeSenderKey(senderKeyName, senderKeyRecord);
    }
    async create(senderKeyName) {
        const senderKeyRecord = (await this.senderKeyStore.loadSenderKey(senderKeyName)) ?? new SenderKeyRecord();
        if (senderKeyRecord.isEmpty()) {
            const keyId = keyhelper.generateSenderKeyId();
            const senderKey = keyhelper.generateSenderKey();
            const signingKey = keyhelper.generateSenderSigningKey();
            senderKeyRecord.setSenderKeyState(keyId, 0, senderKey, signingKey);
            await this.senderKeyStore.storeSenderKey(senderKeyName, senderKeyRecord);
        }
        const state = senderKeyRecord.getSenderKeyState();
        if (!state) {
            throw new Error('No session state available');
        }
        const chainKey = state.getSenderChainKey();
        return new SenderKeyDistributionMessage(state.getKeyId(), chainKey.getIteration(), chainKey.getSeed(), state.getSigningKeyPublic());
    }
}
