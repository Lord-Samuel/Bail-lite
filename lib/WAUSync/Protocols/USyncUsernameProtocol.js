import { assertNodeErrorFree } from '../../WABinary/index.js';
import { USyncUser } from '../USyncUser.js';
export class USyncUsernameProtocol {
    constructor() {
        this.name = 'username';
    }
    getQueryElement() {
        return {
            tag: 'username',
            attrs: {}
        };
    }
    getUserElement(user) {
        void user;
        return null;
    }
    parser(node) {
        if (node.tag === 'username') {
            assertNodeErrorFree(node);
            // text that isn't a known token arrives as a Buffer, which the old check turned into null
            const content = node.content;
            if (typeof content === 'string') {
                return content;
            }
            if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
                return Buffer.from(content).toString('utf-8');
            }
            return null;
        }
        return null;
    }
}
//# sourceMappingURL=USyncUsernameProtocol.js.map
