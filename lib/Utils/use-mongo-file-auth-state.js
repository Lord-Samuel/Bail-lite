import { proto } from '../../WAProto/index.js';
import { initAuthCreds } from './auth-utils.js';
import { BufferJSON } from './generics.js';

/*
code from amiruldev readjusted by @irull2nd, don't delete WM!
modified by samuel rebix
*/
export const useMongoFileAuthState = async (collection) => {
    // Non-object values (strings, arrays such as `device-list`) can't be spread into
    // a document, so they are stored under this wrapper field.
    const VALUE_FIELD = '__value';

    const writeData = (data, id) => {
        const stored = JSON.parse(JSON.stringify(data, BufferJSON.replacer));
        const isPlainObject = stored !== null && typeof stored === 'object' && !Array.isArray(stored);
        const doc = isPlainObject ? stored : { [VALUE_FIELD]: stored };
        // replaceOne (not $set) so fields removed from the value don't linger in the document
        return collection.replaceOne({ _id: id }, doc, { upsert: true });
    };

    // Errors are NOT swallowed: a transient DB failure must not look like "no creds"
    // (which would silently generate a brand new identity).
    const readData = async (id) => {
        const doc = await collection.findOne({ _id: id });
        if (!doc) return null;
        const { _id, ...rest } = doc;
        const value = VALUE_FIELD in rest ? rest[VALUE_FIELD] : rest;
        return JSON.parse(JSON.stringify(value), BufferJSON.reviver);
    };

    // A failed delete (e.g. of a used one-time pre-key) must surface, not be ignored.
    const removeData = async (id) => {
        await collection.deleteOne({ _id: id });
    };

    const creds = (await readData('creds')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const category of Object.keys(data)) {
                        for (const id of Object.keys(data[category])) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: () => {
            return writeData(creds, 'creds');
        }
    };
};
