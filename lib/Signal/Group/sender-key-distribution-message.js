import { proto } from '../../../WAProto/index.js';
import { CiphertextMessage } from './ciphertext-message.js';
export class SenderKeyDistributionMessage extends CiphertextMessage {
    constructor(id, iteration, chainKey, signatureKey, serialized) {
        super();
        if (serialized) {
            try {
                const message = serialized.slice(1);
                const distributionMessage = proto.SenderKeyDistributionMessage.decode(message);
                this.serialized = serialized;
                this.id = distributionMessage.id ?? 0;
                this.iteration = distributionMessage.iteration ?? 0;
                this.chainKey = distributionMessage.chainKey ? Buffer.from(distributionMessage.chainKey) : undefined;
                this.signatureKey = distributionMessage.signingKey ? Buffer.from(distributionMessage.signingKey) : undefined;
            }
            catch (e) {
                throw new Error(String(e), { cause: e });
            }
            // reject malformed key material up front instead of failing later at decrypt time
            if (!this.chainKey || this.chainKey.length !== 32) {
                throw new Error('Invalid sender key distribution message: bad chain key');
            }
            if (!this.signatureKey || (this.signatureKey.length !== 32 && this.signatureKey.length !== 33)) {
                throw new Error('Invalid sender key distribution message: bad signing key');
            }
        }
        else {
            const version = this.intsToByteHighAndLow(this.CURRENT_VERSION, this.CURRENT_VERSION);
            this.id = id;
            this.iteration = iteration;
            this.chainKey = chainKey;
            this.signatureKey = signatureKey;
            const message = proto.SenderKeyDistributionMessage.encode(proto.SenderKeyDistributionMessage.create({
                id,
                iteration,
                chainKey,
                signingKey: this.signatureKey
            })).finish();
            this.serialized = Buffer.concat([Buffer.from([version]), message]);
        }
    }
    intsToByteHighAndLow(highValue, lowValue) {
        return (((highValue << 4) | lowValue) & 0xff) % 256;
    }
    serialize() {
        return this.serialized;
    }
    getType() {
        return this.SENDERKEY_DISTRIBUTION_TYPE;
    }
    getIteration() {
        return this.iteration;
    }
    getChainKey() {
        return this.chainKey;
    }
    getSignatureKey() {
        return this.signatureKey;
    }
    getId() {
        return this.id;
    }
}
