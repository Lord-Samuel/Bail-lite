import NodeCache from '@cacheable/node-cache';
import { Boom } from '@hapi/boom';
import { proto } from '../../WAProto/index.js';
import { BIZ_BOT_SUPPORT_PAYLOAD, DEFAULT_CACHE_TTLS, WA_DEFAULT_EPHEMERAL } from '../Defaults/index.js';
import { aggregateMessageKeysNotFromMe, assertMediaContent, assertMeId, bindWaitForEvent, decryptMediaRetryData, DEF_MEDIA_HOST, encodeNewsletterMessage, encodeSignedDeviceIdentity, encodeWAMessage, encryptMediaRetryRequest, extractDeviceJids, generateMessageIDV2, generateParticipantHashV2, generateWAMessage, getStatusCodeForMediaRetry, getUrlFromDirectPath, getWAUploadToServer, MessageRetryManager, normalizeMessageContent, parseAndInjectE2ESessions, generateWAMessageFromContent, unixTimestampSeconds } from '../Utils/index.js';
import { getUrlInfo } from '../Utils/link-preview.js';
import { createHmac } from 'crypto';
import { makeKeyedMutex, makeMutex } from '../Utils/make-mutex.js';
import { getMessageReportingToken, shouldIncludeReportingToken } from '../Utils/reporting-utils.js';
import { buildMergedTcTokenIndexWrite, isTcTokenExpired, resolveIssuanceJid, resolveTcTokenJid, shouldSendNewTcToken, storeTcTokensFromIqResult } from '../Utils/tc-token-utils.js';
import { areJidsSameUser, getAdditionalNode, getBinaryNodeChild, getBinaryNodeChildren, isHostedLidUser, isHostedPnUser, isJidBot, isJidGroup, isJidMetaAI, isLidUser, isPnUser, jidDecode, jidEncode, jidNormalizedUser, PSA_WID, S_WHATSAPP_NET } from '../WABinary/index.js';
import { USyncQuery, USyncUser } from '../WAUSync/index.js';
import { makeNewsletterSocket } from './newsletter.js';
import { MessageHandler } from './message-handlers.js';

export const makeMessagesSocket = (config) => {
    const { logger, linkPreviewImageThumbnailWidth, generateHighQualityLinkPreview, options: httpRequestOptions, patchMessageBeforeSending, cachedGroupMetadata, enableRecentMessageCache, maxMsgRetryCount } = config;
    const sock = makeNewsletterSocket(config);
    const { ev, authState, messageMutex, signalRepository, upsertMessage, query, fetchPrivacySettings, sendNode, groupMetadata, groupToggleEphemeral, registerSocketEndHandler } = sock;
    const getLIDForPN = signalRepository.lidMapping.getLIDForPN.bind(signalRepository.lidMapping);

    const inFlightTcTokenIssuance = new Set();
    const userDevicesCache = config.userDevicesCache ||
        new NodeCache({
            stdTTL: DEFAULT_CACHE_TTLS.USER_DEVICES,
            useClones: false
        });
    const devicesMutex = makeMutex();
    const messageRetryManager = enableRecentMessageCache ? new MessageRetryManager(logger, maxMsgRetryCount) : null;
    const encryptionMutex = makeKeyedMutex();
    const sessionFetchMutex = makeKeyedMutex();
    let mediaConn;
    let mediaHost = DEF_MEDIA_HOST;
    const refreshMediaConn = async (forceGet = false) => {
        const media = await mediaConn?.catch(() => undefined);
        if (!media || forceGet || new Date().getTime() - media.fetchDate.getTime() > media.ttl * 1000) {
            mediaConn = (async () => {
                try {
                    const result = await query({
                        tag: 'iq',
                        attrs: {
                            type: 'set',
                            xmlns: 'w:m',
                            to: S_WHATSAPP_NET
                        },
                        content: [{ tag: 'media_conn', attrs: {} }]
                    });
                    const mediaConnNode = getBinaryNodeChild(result, 'media_conn');
                    const node = {
                        hosts: getBinaryNodeChildren(mediaConnNode, 'host').map(({ attrs }) => ({
                            hostname: attrs.hostname,
                            maxContentLengthBytes: +attrs.maxContentLengthBytes
                        })),
                        auth: mediaConnNode.attrs.auth,
                        ttl: +mediaConnNode.attrs.ttl,
                        fetchDate: new Date()
                    };
                    logger.debug('fetched media conn');
                    if (node.hosts[0]) {
                        mediaHost = node.hosts[0].hostname;
                    }
                    return node;
                }
                catch (err) {
                    logger.warn({ err }, 'failed to fetch media conn, will retry on next call');
                    mediaConn = undefined;
                    throw err;
                }
            })();
        }
        return mediaConn;
    };
    const sendReceipt = async (jid, participant, messageIds, type) => {
        if (!messageIds || messageIds.length === 0) {
            throw new Boom('missing ids in receipt');
        }
        const node = {
            tag: 'receipt',
            attrs: { id: messageIds[0] }
        };
        const isReadReceipt = type === 'read' || type === 'read-self';
        if (isReadReceipt) {
            node.attrs.t = unixTimestampSeconds().toString();
        }
        if (type === 'sender' && (isPnUser(jid) || isLidUser(jid))) {
            node.attrs.recipient = jid;
            node.attrs.to = participant;
        }
        else {
            node.attrs.to = jid;
            if (participant) {
                node.attrs.participant = participant;
            }
        }
        if (type) {
            node.attrs.type = type;
        }
        const remainingMessageIds = messageIds.slice(1);
        if (remainingMessageIds.length) {
            node.content = [{
                tag: 'list',
                attrs: {},
                content: remainingMessageIds.map(id => ({ tag: 'item', attrs: { id } }))
            }];
        }
        logger.debug({ attrs: node.attrs, messageIds }, 'sending receipt for messages');
        await sendNode(node);
    };
    const sendReceipts = async (keys, type) => {
        const recps = aggregateMessageKeysNotFromMe(keys);
        for (const { jid, participant, messageIds } of recps) {
            await sendReceipt(jid, participant, messageIds, type);
        }
    };
    const readMessages = async (keys) => {
        const privacySettings = await fetchPrivacySettings();
        const readType = privacySettings.readreceipts === 'all' ? 'read' : 'read-self';
        await sendReceipts(keys, readType);
    };
    const getUSyncDevices = async (jids, useCache, ignoreZeroDevices) => {
        const deviceResults = [];
        if (!useCache) {
            logger.debug('not using cache for devices');
        }
        const toFetch = [];
        const jidsWithUser = jids
            .map(jid => {
            const decoded = jidDecode(jid);
            const user = decoded?.user;
            const device = decoded?.device;
            const isExplicitDevice = typeof device === 'number' && device >= 0;
            if (isExplicitDevice && user) {
                deviceResults.push({ user, device, jid });
                return null;
            }
            jid = jidNormalizedUser(jid);
            return { jid, user };
        })
            .filter(jid => jid !== null);
        let mgetDevices;
        if (useCache && userDevicesCache.mget) {
            const usersToFetch = jidsWithUser.map(j => j?.user).filter(Boolean);
            mgetDevices = await userDevicesCache.mget(usersToFetch);
        }
        if (useCache && !userDevicesCache.mget) {
            const usersToFetch = jidsWithUser.map(j => j?.user).filter(Boolean);
            const fetched = await Promise.all(usersToFetch.map(user => userDevicesCache.get(user)));
            mgetDevices = Object.fromEntries(usersToFetch.map((user, i) => [user, fetched[i]]));
        }
        for (const { jid, user } of jidsWithUser) {
            if (useCache) {
                const devices = mgetDevices?.[user];
                if (devices) {
                    const devicesWithJid = devices.map(d => ({
                        ...d,
                        jid: jidEncode(d.user, d.server, d.device)
                    }));
                    deviceResults.push(...devicesWithJid);
                    logger.trace({ user }, 'using cache for devices');
                }
                else {
                    toFetch.push(jid);
                }
            }
            else {
                toFetch.push(jid);
            }
        }
        if (!toFetch.length) {
            return deviceResults;
        }
        const requestedLidUsers = new Set();
        for (const jid of toFetch) {
            if (isLidUser(jid) || isHostedLidUser(jid)) {
                const user = jidDecode(jid)?.user;
                if (user)
                    requestedLidUsers.add(user);
            }
        }
        const query = new USyncQuery().withContext('message').withDeviceProtocol().withLIDProtocol();
        for (const jid of toFetch) {
            query.withUser(new USyncUser().withId(jid));
        }
        const result = await sock.executeUSyncQuery(query);
        if (result) {
            const lidResults = result.list.filter(a => !!a.lid);
            if (lidResults.length > 0) {
                logger.trace('Storing LID maps from device call');
                await signalRepository.lidMapping.storeLIDPNMappings(lidResults.map(a => ({ lid: a.lid, pn: a.id })));
                try {
                    const lids = lidResults.map(a => a.lid);
                    if (lids.length) {
                        await assertSessions(lids, true);
                    }
                }
                catch (e) {
                    logger.warn({ e, count: lidResults.length }, 'failed to assert sessions for newly mapped LIDs');
                }
            }
            const extracted = extractDeviceJids(result?.list, authState.creds.me.id, authState.creds.me.lid, ignoreZeroDevices);
            const deviceMap = {};
            for (const item of extracted) {
                deviceMap[item.user] = deviceMap[item.user] || [];
                deviceMap[item.user]?.push(item);
            }
            for (const [user, userDevices] of Object.entries(deviceMap)) {
                const isLidUser = requestedLidUsers.has(user);
                for (const item of userDevices) {
                    const finalJid = isLidUser
                        ? jidEncode(user, item.server, item.device)
                        : jidEncode(item.user, item.server, item.device);
                    deviceResults.push({ ...item, jid: finalJid });
                    logger.debug({
                        user: item.user,
                        device: item.device,
                        finalJid,
                        usedLid: isLidUser
                    }, 'Processed device with LID priority');
                }
            }
            await devicesMutex.mutex(async () => {
                if (userDevicesCache.mset) {
                    await userDevicesCache.mset(Object.entries(deviceMap).map(([key, value]) => ({ key, value })));
                }
                else {
                    for (const key in deviceMap) {
                        if (deviceMap[key])
                            await userDevicesCache.set(key, deviceMap[key]);
                    }
                }
            });
            const userDeviceUpdates = {};
            for (const [userId, devices] of Object.entries(deviceMap)) {
                if (devices && devices.length > 0) {
                    userDeviceUpdates[userId] = devices.map(d => d.device?.toString() || '0');
                }
            }
            if (Object.keys(userDeviceUpdates).length > 0) {
                try {
                    await authState.keys.set({ 'device-list': userDeviceUpdates });
                    logger.debug({ userCount: Object.keys(userDeviceUpdates).length }, 'stored user device lists for bulk migration');
                }
                catch (error) {
                    logger.warn({ error }, 'failed to store user device lists');
                }
            }
        }
        return deviceResults;
    };
    const updateMemberLabel = (jid, memberLabel) => {
        return relayMessage(jid, {
            protocolMessage: {
                type: proto.Message.ProtocolMessage.Type.GROUP_MEMBER_LABEL_CHANGE,
                memberLabel: {
                    label: memberLabel?.slice(0, 30),
                    labelTimestamp: unixTimestampSeconds()
                }
            }
        }, {
            additionalNodes: [{
                tag: 'meta',
                attrs: {
                    tag_reason: 'user_update',
                    appdata: 'member_tag'
                },
                content: undefined
            }]
        });
    };
    const assertSessions = async (jids, force) => {
        let didFetchNewSession = false;
        const uniqueJids = [...new Set(jids)];
        const jidsRequiringFetch = [];
        logger.debug({ jids }, 'assertSessions call with jids');
        for (const jid of uniqueJids) {
            if (!force) {
                const sessionValidation = await signalRepository.validateSession(jid);
                if (sessionValidation.exists) {
                    continue;
                }
            }
            jidsRequiringFetch.push(jid);
        }
        if (jidsRequiringFetch.length) {
            const results = await Promise.all(jidsRequiringFetch.map(jid =>
                sessionFetchMutex.mutex(jid, async () => {
                    if (!force) {
                        const v = await signalRepository.validateSession(jid);
                        if (v.exists)
                            return false;
                    }
                    const wireJid = (isLidUser(jid) || isHostedLidUser(jid))
                        ? jid
                        : (await signalRepository.lidMapping.getLIDsForPNs([jid]))?.[0]?.lid;
                    const result = await query({
                        tag: 'iq',
                        attrs: { xmlns: 'encrypt', type: 'get', to: S_WHATSAPP_NET },
                        content: [{
                            tag: 'key',
                            attrs: {},
                            content: [{
                                tag: 'user',
                                attrs: force ? { jid: wireJid || jid, reason: 'identity' } : { jid: wireJid || jid }
                            }]
                        }]
                    });
                    await parseAndInjectE2ESessions(result, signalRepository);
                    return true;
                })
            ));
            didFetchNewSession = results.some(Boolean);
        }
        return didFetchNewSession;
    };
    const sendPeerDataOperationMessage = async (pdoMessage) => {
        if (!authState.creds.me?.id) {
            throw new Boom('Not authenticated');
        }
        const protocolMessage = {
            protocolMessage: {
                peerDataOperationRequestMessage: pdoMessage,
                type: proto.Message.ProtocolMessage.Type.PEER_DATA_OPERATION_REQUEST_MESSAGE
            }
        };
        const meJid = jidNormalizedUser(authState.creds.me.id);
        const msgId = await relayMessage(meJid, protocolMessage, {
            additionalAttributes: {
                category: 'peer',
                push_priority: 'high_force'
            },
            additionalNodes: [{
                tag: 'meta',
                attrs: { appdata: 'default' }
            }]
        });
        return msgId;
    };
    const createParticipantNodes = async (recipientJids, message, extraAttrs, dsmMessage) => {
        if (!recipientJids.length) {
            return { nodes: [], shouldIncludeDeviceIdentity: false, failedJids: [] };
        }
        const patched = await patchMessageBeforeSending(message, recipientJids);
        const patchedMessages = Array.isArray(patched)
            ? patched
            : recipientJids.map(jid => ({ recipientJid: jid, message: patched }));
        let shouldIncludeDeviceIdentity = false;
        const meId = authState.creds.me.id;
        const meLid = authState.creds.me?.lid;
        const meLidUser = meLid ? jidDecode(meLid)?.user : null;
        const failedJids = [];
        const encryptionPromises = patchedMessages.map(async ({ recipientJid: jid, message: patchedMessage }) => {
            try {
                if (!jid)
                    return null;
                let msgToEncrypt = patchedMessage;
                if (dsmMessage) {
                    const { user: targetUser } = jidDecode(jid);
                    const { user: ownPnUser } = jidDecode(meId);
                    const ownLidUser = meLidUser;
                    const isOwnUser = targetUser === ownPnUser || (ownLidUser && targetUser === ownLidUser);
                    const isExactSenderDevice = jid === meId || (meLid && jid === meLid);
                    if (isOwnUser && !isExactSenderDevice) {
                        msgToEncrypt = dsmMessage;
                        logger.debug({ jid, targetUser }, 'Using DSM for own device');
                    }
                }
                const bytes = encodeWAMessage(msgToEncrypt);
                const mutexKey = jid;
                const node = await encryptionMutex.mutex(mutexKey, async () => {
                    const { type, ciphertext } = await signalRepository.encryptMessage({ jid, data: bytes });
                    if (type === 'pkmsg') {
                        shouldIncludeDeviceIdentity = true;
                    }
                    return {
                        tag: 'to',
                        attrs: { jid },
                        content: [{
                            tag: 'enc',
                            attrs: { v: '2', type, ...(extraAttrs || {}) },
                            content: ciphertext
                        }]
                    };
                });
                return node;
            }
            catch (err) {
                logger.error({ jid, err }, 'Failed to encrypt for recipient');
                failedJids.push(jid);
                return null;
            }
        });
        const nodes = (await Promise.all(encryptionPromises)).filter(node => node !== null);
        if (recipientJids.length > 0 && nodes.length === 0) {
            throw new Boom('All encryptions failed', { statusCode: 500 });
        }
        if (failedJids.length) {
            logger.warn({ failedJids, total: recipientJids.length }, 'partial encryption failure — message under-delivered to some devices');
        }
        return { nodes, shouldIncludeDeviceIdentity, failedJids };
    };
    const relayMessage = async (jid, message, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList, isSecret }) => {
        const meId = assertMeId(authState.creds);
        const meLid = authState.creds.me?.lid;
        const isRetryResend = Boolean(participant?.jid);
        let shouldIncludeDeviceIdentity = isRetryResend;
        const statusJid = 'status@broadcast';
        const { user, server } = jidDecode(jid);
        const isGroup = server === 'g.us';
        const isStatus = jid === statusJid;
        const isLid = server === 'lid';
        const isNewsletter = server === 'newsletter';
        const isGroupOrStatus = isGroup || isStatus;
        const finalJid = jid;
        msgId = msgId || generateMessageIDV2(meId);
        useUserDevicesCache = useUserDevicesCache !== false;
        useCachedGroupMetadata = useCachedGroupMetadata !== false && !isStatus;
        const participants = [];
        const destinationJid = !isStatus ? finalJid : statusJid;
        const binaryNodeContent = [];
        const devices = [];
        let reportingMessage;
        const meMsg = {
            deviceSentMessage: {
                destinationJid,
                message
            },
            messageContextInfo: message.messageContextInfo
        };
        const extraAttrs = {};

        const requiresViewOnce = !!(message.buttonsMessage || message.templateMessage || message.listMessage || message.interactiveMessage);
        if (requiresViewOnce) {
            message = {
                viewOnceMessage: {
                    message: {
                        ...message
                    }
                }
            };
        }

        if (participant) {
            if (!isGroup && !isStatus) {
                additionalAttributes = { ...additionalAttributes, device_fanout: 'false' };
            }
            const { user, device } = jidDecode(participant.jid);
            devices.push({ user, device, jid: participant.jid });
        }

        await authState.keys.transaction(async () => {
            const innerMessage = normalizeMessageContent(message);
            const mediaType = getMediaType(innerMessage);
            if (mediaType) {
                extraAttrs['mediatype'] = mediaType;
            }
            if (isNewsletter) {
                const patched = patchMessageBeforeSending ? await patchMessageBeforeSending(message, []) : message;
                const bytes = encodeNewsletterMessage(patched);
                if (additionalNodes && additionalNodes.length > 0) {
                    binaryNodeContent.push(...additionalNodes);
                }
                binaryNodeContent.push({
                    tag: 'plaintext',
                    attrs: extraAttrs,
                    content: bytes
                });
                const stanza = {
                    tag: 'message',
                    attrs: {
                        to: jid,
                        id: msgId,
                        type: getMessageType(innerMessage),
                        ...(additionalAttributes || {})
                    },
                    content: binaryNodeContent
                };
                logger.debug({ msgId }, `sending newsletter message to ${jid}`);
                await sendNode(stanza);
                return;
            }
            if (normalizeMessageContent(message)?.pinInChatMessage || normalizeMessageContent(message)?.reactionMessage) {
                extraAttrs['decrypt-fail'] = 'hide';
            }
            if (isGroupOrStatus && !isRetryResend) {
                const [groupData, senderKeyMap] = await Promise.all([
                    (async () => {
                        let groupData = useCachedGroupMetadata && cachedGroupMetadata ? await cachedGroupMetadata(jid) : undefined;
                        if (groupData && Array.isArray(groupData?.participants)) {
                            logger.trace({ jid, participants: groupData.participants.length }, 'using cached group metadata');
                        }
                        else if (!isStatus) {
                            groupData = await groupMetadata(jid);
                        }
                        return groupData;
                    })(),
                    (async () => {
                        if (!participant && !isStatus) {
                            const result = await authState.keys.get('sender-key-memory', [jid]);
                            return result[jid] || {};
                        }
                        return {};
                    })()
                ]);
                const participantsList = groupData ? groupData.participants.map(p => p.id) : [];
                if (groupData?.ephemeralDuration && groupData.ephemeralDuration > 0) {
                    additionalAttributes = {
                        ...additionalAttributes,
                        expiration: groupData.ephemeralDuration.toString()
                    };
                }
                if (isStatus && statusJidList) {
                    participantsList.push(...statusJidList);
                }
                const additionalDevices = await getUSyncDevices(participantsList, !!useUserDevicesCache, false);
                devices.push(...additionalDevices);
                if (isGroup) {
                    additionalAttributes = {
                        ...additionalAttributes,
                        addressing_mode: groupData?.addressingMode || 'lid'
                    };
                }
                const patched = await patchMessageBeforeSending(message);
                if (Array.isArray(patched)) {
                    throw new Boom('Per-jid patching is not supported in groups');
                }
                const bytes = encodeWAMessage(patched);
                reportingMessage = patched;
                const groupAddressingMode = additionalAttributes?.['addressing_mode'] || groupData?.addressingMode || 'lid';
                const groupSenderIdentity = groupAddressingMode === 'lid' && meLid ? meLid : meId;
                const { ciphertext, senderKeyDistributionMessage } = await signalRepository.encryptGroupMessage({
                    group: destinationJid,
                    data: bytes,
                    meId: groupSenderIdentity
                });
                const senderKeyRecipients = [];
                for (const device of devices) {
                    const deviceJid = device.jid;
                    const hasKey = !!senderKeyMap[deviceJid];
                    if ((!hasKey || !!participant) &&
                        !isHostedLidUser(deviceJid) &&
                        !isHostedPnUser(deviceJid) &&
                        device.device !== 99) {
                        senderKeyRecipients.push(deviceJid);
                        senderKeyMap[deviceJid] = true;
                    }
                }
                if (senderKeyRecipients.length) {
                    logger.debug({ senderKeyJids: senderKeyRecipients }, 'sending new sender key');
                    const senderKeyMsg = {
                        senderKeyDistributionMessage: {
                            axolotlSenderKeyDistributionMessage: senderKeyDistributionMessage,
                            groupId: destinationJid
                        }
                    };
                    const senderKeySessionTargets = senderKeyRecipients;
                    await assertSessions(senderKeySessionTargets);
                    const result = await createParticipantNodes(senderKeyRecipients, senderKeyMsg, extraAttrs);
                    shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || result.shouldIncludeDeviceIdentity;
                    participants.push(...result.nodes);
                }
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: { v: '2', type: 'skmsg', ...extraAttrs },
                    content: ciphertext
                });
                await authState.keys.set({ 'sender-key-memory': { [jid]: senderKeyMap } });
            }
            else {
                let ownId = meId;
                if (isLid && meLid) {
                    ownId = meLid;
                    logger.debug({ to: jid, ownId }, 'Using LID identity for @lid conversation');
                }
                else {
                    logger.debug({ to: jid, ownId }, 'Using PN identity for @s.whatsapp.net conversation');
                }
                const { user: ownUser } = jidDecode(ownId);
                if (!participant) {
                    const patchedForReporting = await patchMessageBeforeSending(message, [jid]);
                    reportingMessage = Array.isArray(patchedForReporting)
                        ? patchedForReporting.find(item => item.recipientJid === jid) || patchedForReporting[0]
                        : patchedForReporting;
                }
                if (!isRetryResend) {
                    const targetUserServer = isLid ? 'lid' : 's.whatsapp.net';
                    devices.push({
                        user,
                        device: 0,
                        jid: jidEncode(user, targetUserServer, 0)
                    });
                    if (user !== ownUser) {
                        const ownUserServer = isLid ? 'lid' : 's.whatsapp.net';
                        const ownUserForAddressing = isLid && meLid ? jidDecode(meLid).user : jidDecode(meId).user;
                        devices.push({
                            user: ownUserForAddressing,
                            device: 0,
                            jid: jidEncode(ownUserForAddressing, ownUserServer, 0)
                        });
                    }
                    if (additionalAttributes?.['category'] !== 'peer') {
                        devices.length = 0;
                        const senderIdentity = isLid && meLid
                            ? jidEncode(jidDecode(meLid)?.user, 'lid', undefined)
                            : jidEncode(jidDecode(meId)?.user, 's.whatsapp.net', undefined);
                        const sessionDevices = await getUSyncDevices([senderIdentity, jid], true, false);
                        devices.push(...sessionDevices);
                        logger.debug({
                            deviceCount: devices.length,
                            devices: devices.map(d => `${d.user}:${d.device}@${jidDecode(d.jid)?.server}`)
                        }, 'Device enumeration complete with unified addressing');
                    }
                }
                const allRecipients = [];
                const meRecipients = [];
                const otherRecipients = [];
                const { user: mePnUser } = jidDecode(meId);
                const { user: meLidUser } = meLid ? jidDecode(meLid) : { user: null };
                for (const { user, jid } of devices) {
                    const isExactSenderDevice = jid === meId || (meLid && jid === meLid);
                    if (isExactSenderDevice) {
                        logger.debug({ jid, meId, meLid }, 'Skipping exact sender device (whatsmeow pattern)');
                        continue;
                    }
                    const isMe = user === mePnUser || user === meLidUser;
                    const hasDevice = jid.includes(':');
                    if (isSecret && !(!isMe && !hasDevice)) {
                        continue;
                    }
                    if (isMe) {
                        meRecipients.push(jid);
                    }
                    else {
                        otherRecipients.push(jid);
                    }
                    allRecipients.push(jid);
                }
                await assertSessions(allRecipients);
                const [{ nodes: meNodes, shouldIncludeDeviceIdentity: s1 }, { nodes: otherNodes, shouldIncludeDeviceIdentity: s2 }] = await Promise.all([
                    createParticipantNodes(meRecipients, meMsg || message, extraAttrs),
                    createParticipantNodes(otherRecipients, message, extraAttrs, meMsg)
                ]);
                participants.push(...meNodes);
                participants.push(...otherNodes);
                if (meRecipients.length > 0 || otherRecipients.length > 0) {
                    extraAttrs['phash'] = generateParticipantHashV2([...meRecipients, ...otherRecipients]);
                }
                shouldIncludeDeviceIdentity = shouldIncludeDeviceIdentity || s1 || s2;
            }
            if (isRetryResend) {
                const isParticipantLid = isLidUser(participant.jid);
                const isMe = areJidsSameUser(participant.jid, isParticipantLid ? meLid : meId);
                let messageToSend = message;
                if (isGroupOrStatus) {
                    let groupSenderIdentity;
                    if (meLid && (await signalRepository.hasSenderKey({ group: destinationJid, meId: meLid }))) {
                        groupSenderIdentity = meLid;
                    }
                    else if (await signalRepository.hasSenderKey({ group: destinationJid, meId })) {
                        groupSenderIdentity = meId;
                    }
                    if (groupSenderIdentity) {
                        try {
                            const skdm = await signalRepository.getSenderKeyDistributionMessage({
                                group: destinationJid,
                                meId: groupSenderIdentity
                            });
                            messageToSend = {
                                ...message,
                                senderKeyDistributionMessage: {
                                    groupId: destinationJid,
                                    axolotlSenderKeyDistributionMessage: skdm
                                }
                            };
                        }
                        catch (err) {
                            logger.warn({ err, jid: destinationJid }, 'failed to build SKDM for retry, sending without it');
                        }
                    }
                }
                const encodedMessageToSend = isMe
                    ? encodeWAMessage({
                        deviceSentMessage: {
                            destinationJid,
                            message: messageToSend
                        }
                    })
                    : encodeWAMessage(messageToSend);
                const { type, ciphertext: encryptedContent } = await signalRepository.encryptMessage({
                    data: encodedMessageToSend,
                    jid: participant.jid
                });
                binaryNodeContent.push({
                    tag: 'enc',
                    attrs: {
                        v: '2',
                        type,
                        count: participant.count.toString()
                    },
                    content: encryptedContent
                });
            }
            if (participants.length) {
                if (additionalAttributes?.['category'] === 'peer') {
                    const peerNode = participants[0]?.content?.[0];
                    if (peerNode) {
                        binaryNodeContent.push(peerNode);
                    }
                }
                else {
                    binaryNodeContent.push({
                        tag: 'participants',
                        attrs: {},
                        content: participants
                    });
                }
            }
            const stanza = {
                tag: 'message',
                attrs: {
                    id: msgId,
                    to: destinationJid,
                    type: getMessageType(message),
                    ...(additionalAttributes || {})
                },
                content: binaryNodeContent
            };
            if (participant) {
                if (isJidGroup(destinationJid)) {
                    stanza.attrs.to = destinationJid;
                    stanza.attrs.participant = participant.jid;
                }
                else if (areJidsSameUser(participant.jid, meId)) {
                    stanza.attrs.to = participant.jid;
                    stanza.attrs.recipient = destinationJid;
                }
                else {
                    stanza.attrs.to = participant.jid;
                }
            }
            else {
                stanza.attrs.to = destinationJid;
            }
            if (shouldIncludeDeviceIdentity) {
                stanza.content.push({
                    tag: 'device-identity',
                    attrs: {},
                    content: encodeSignedDeviceIdentity(authState.creds.account, true)
                });
                logger.debug({ jid }, 'adding device identity');
            }
            if (!isNewsletter &&
                !isRetryResend &&
                reportingMessage?.messageContextInfo?.messageSecret &&
                shouldIncludeReportingToken(reportingMessage)) {
                try {
                    const encoded = encodeWAMessage(reportingMessage);
                    const reportingKey = {
                        id: msgId,
                        fromMe: true,
                        remoteJid: destinationJid,
                        participant: participant?.jid
                    };
                    const reportingNode = await getMessageReportingToken(encoded, reportingMessage, reportingKey);
                    if (reportingNode) {
                        stanza.content.push(reportingNode);
                        logger.trace({ jid }, 'added reporting token to message');
                    }
                }
                catch (error) {
                    logger.warn({ jid, trace: error?.stack }, 'failed to attach reporting token');
                }
            }
            const isPeerMessage = additionalAttributes?.['category'] === 'peer';
            const is1on1Send = !isGroup && !isRetryResend && !isStatus && !isNewsletter && !isPeerMessage;
            const tcTokenJid = is1on1Send ? await resolveTcTokenJid(destinationJid, getLIDForPN) : destinationJid;
            const contactTcTokenData = is1on1Send ? await authState.keys.get('tctoken', [tcTokenJid]) : {};
            const existingTokenEntry = contactTcTokenData[tcTokenJid];
            let tcTokenBuffer = existingTokenEntry?.token;
            if (tcTokenBuffer?.length && isTcTokenExpired(existingTokenEntry?.timestamp)) {
                logger.debug({ jid: destinationJid, timestamp: existingTokenEntry?.timestamp }, 'tctoken expired, clearing');
                tcTokenBuffer = undefined;
                const cleared = existingTokenEntry?.senderTimestamp !== undefined
                    ? { token: Buffer.alloc(0), senderTimestamp: existingTokenEntry.senderTimestamp }
                    : null;
                try {
                    await authState.keys.set({ tctoken: { [tcTokenJid]: cleared } });
                }
                catch (err) {
                    logger.debug({ jid: destinationJid, err: err?.message }, 'failed to persist tctoken expiry cleanup');
                }
            }
            if (tcTokenBuffer?.length && sock.serverProps.privacyTokenOn1to1) {
                stanza.content.push({
                    tag: 'tctoken',
                    attrs: {},
                    content: tcTokenBuffer
                });
            }
            if (additionalNodes && additionalNodes.length > 0) {
                stanza.content.push(...additionalNodes);
            }

            if (is1on1Send && !tcTokenBuffer?.length) {
                try {
                    const lidJid = await resolveTcTokenJid(destinationJid, getLIDForPN);
                    if (isLidUser(lidJid)) {
                        const saltRes = await authState.keys.get('nct-salt', ['default']);
                        const nctSalt = saltRes?.default;
                        if (nctSalt?.length) {
                            const cs = createHmac('sha256', Buffer.from(nctSalt)).update(Buffer.from(lidJid, 'utf8')).digest();
                            stanza.content.push({
                                tag: 'cstoken',
                                attrs: {},
                                content: cs
                            });
                            logger.debug({ jid: destinationJid, lid: lidJid }, 'attached cstoken (nct fallback)');
                        } else {
                            logger.debug({ jid: destinationJid }, 'cstoken skipped — no nct salt stored');
                        }
                    }
                } catch (err) {
                    logger.debug({ jid: destinationJid, err: err?.message }, 'cstoken attach failed');
                }
            }

            const hasBizNode = stanza.content.some(
                (node) => node && typeof node === 'object' && node.tag === 'biz'
            );

            if (!hasBizNode && !isNewsletter && !isStatus) {
                const buttonType = getButtonType(innerMessage);
                if (buttonType) {
                    const bizNodes = getAdditionalNode(buttonType);
                    if (bizNodes?.length) {
                        stanza.content.push(...bizNodes);
                        logger.debug({ jid, buttonType }, 'adding business node');
                    }
                }
            }

            logger.debug({ msgId }, `sending message to ${participants.length} devices`);
            await sendNode(stanza);
            const isProtocolMsg = !!normalizeMessageContent(message)?.protocolMessage;
            const isBotOrPSA = destinationJid === PSA_WID || isJidBot(destinationJid) || isJidMetaAI(destinationJid);
            if (is1on1Send &&
                !isProtocolMsg &&
                !isBotOrPSA &&
                shouldSendNewTcToken(existingTokenEntry?.senderTimestamp) &&
                !inFlightTcTokenIssuance.has(tcTokenJid)) {
                inFlightTcTokenIssuance.add(tcTokenJid);
                const issueTimestamp = unixTimestampSeconds();
                const getPNForLID = signalRepository.lidMapping.getPNForLID.bind(signalRepository.lidMapping);
                resolveIssuanceJid(destinationJid, sock.serverProps.lidTrustedTokenIssueToLid, getLIDForPN, getPNForLID)
                    .then(issueJid => issuePrivacyTokens([issueJid], issueTimestamp))
                    .then(async (result) => {
                    await storeTcTokensFromIqResult({
                        result,
                        fallbackJid: tcTokenJid,
                        keys: authState.keys,
                        getLIDForPN
                    });
                    const currentData = await authState.keys.get('tctoken', [tcTokenJid]);
                    const currentEntry = currentData[tcTokenJid];
                    const indexWrite = await buildMergedTcTokenIndexWrite(authState.keys, [tcTokenJid]);
                    await authState.keys.set({
                        tctoken: {
                            [tcTokenJid]: {
                                token: Buffer.alloc(0),
                                ...currentEntry,
                                senderTimestamp: issueTimestamp
                            },
                            ...indexWrite
                        }
                    });
                })
                    .catch(err => {
                    logger.debug({ jid: destinationJid, err: err?.message }, 'fire-and-forget tctoken issuance failed');
                })
                    .finally(() => {
                    inFlightTcTokenIssuance.delete(tcTokenJid);
                });
            }
            if (messageRetryManager && !participant) {
                messageRetryManager.addRecentMessage(destinationJid, msgId, message);
            }
        }, meId);
        return msgId;
    };
    const getMessageType = (message) => {
        const normalizedMessage = normalizeMessageContent(message);
        if (!normalizedMessage)
            return 'text';
        if (normalizedMessage.reactionMessage || normalizedMessage.encReactionMessage) {
            return 'reaction';
        }
        if (normalizedMessage.pollCreationMessage ||
            normalizedMessage.pollCreationMessageV2 ||
            normalizedMessage.pollCreationMessageV3 ||
            normalizedMessage.pollUpdateMessage) {
            return 'poll';
        }
        if (normalizedMessage.eventMessage) {
            return 'event';
        }
        if (getMediaType(normalizedMessage) !== '') {
            return 'media';
        }
        return 'text';
    };
    const getMediaType = (message) => {
        if (message.imageMessage) {
            return 'image';
        }
        else if (message.videoMessage) {
            return message.videoMessage.gifPlayback ? 'gif' : 'video';
        }
        else if (message.audioMessage) {
            return message.audioMessage.ptt ? 'ptt' : 'audio';
        }
        else if (message.contactMessage) {
            return 'vcard';
        }
        else if (message.documentMessage) {
            return 'document';
        }
        else if (message.contactsArrayMessage) {
            return 'contact_array';
        }
        else if (message.liveLocationMessage) {
            return 'livelocation';
        }
        else if (message.stickerMessage) {
            return 'sticker';
        }
        else if (message.listMessage) {
            return 'list';
        }
        else if (message.listResponseMessage) {
            return 'list_response';
        }
        else if (message.buttonsResponseMessage) {
            return 'buttons_response';
        }
        else if (message.orderMessage) {
            return 'order';
        }
        else if (message.productMessage) {
            return 'product';
        }
        else if (message.interactiveResponseMessage) {
            return 'native_flow_response';
        }
        else if (message.groupInviteMessage) {
            return 'url';
        }
        return '';
    };

    const NATIVE_FLOW_BUTTON_MAP = {
        review_and_pay: 'review_and_pay',
        review_order: 'review_order',
        payment_info: 'payment_info',
        payment_status: 'payment_status',
        payment_method: 'payment_method'
    };

    const getButtonType = (message) => {
        const msg = normalizeMessageContent(message) || message;

        if (msg?.buttonsMessage || msg?.listMessage) {
            return msg.listMessage ? 'list' : 'buttons';
        }

        const vm = msg?.viewOnceMessage?.message || msg?.viewOnceMessageV2?.message;
        const im = vm?.interactiveMessage || msg?.interactiveMessage;
        if (!im?.nativeFlowMessage) {
            if (msg?.interactiveResponseMessage) return 'interactive_response';
            return null;
        }

        const btnName = im.nativeFlowMessage?.buttons?.[0]?.name;
        if (btnName && NATIVE_FLOW_BUTTON_MAP[btnName]) {
            return NATIVE_FLOW_BUTTON_MAP[btnName];
        }
        return 'interactive';
    };

    const issuePrivacyTokens = async (jids, timestamp) => {
        const t = (timestamp ?? unixTimestampSeconds()).toString();
        const result = await query({
            tag: 'iq',
            attrs: {
                to: S_WHATSAPP_NET,
                type: 'set',
                xmlns: 'privacy'
            },
            content: [{
                tag: 'tokens',
                attrs: {},
                content: jids.map(jid => ({
                    tag: 'token',
                    attrs: {
                        jid: jidNormalizedUser(jid),
                        t,
                        type: 'trusted_contact'
                    }
                }))
            }]
        });
        return result;
    };
    const waUploadToServer = getWAUploadToServer(config, refreshMediaConn);
    const msgHandler = new MessageHandler(waUploadToServer, relayMessage, () => authState.creds.me?.id);
    const waitForMsgMediaUpdate = bindWaitForEvent(ev, 'messages.media-update');
    registerSocketEndHandler(() => {
        if (!config.userDevicesCache && userDevicesCache.close) {
            userDevicesCache.close();
        }
        mediaConn = undefined;
        if (messageRetryManager) {
            messageRetryManager.clear();
        }
    });
    return {
        ...sock,
        userDevicesCache,
        devicesMutex,
        issuePrivacyTokens,
        assertSessions,
        relayMessage,
        sendReceipt,
        sendReceipts,
        readMessages,
        refreshMediaConn,
        getMediaHost: () => mediaHost,
        waUploadToServer,
        fetchPrivacySettings,
        sendPeerDataOperationMessage,
        createParticipantNodes,
        getUSyncDevices,
        messageRetryManager,
        updateMemberLabel,
        updateMediaMessage: async (message) => {
            const content = assertMediaContent(message.message);
            const mediaKey = content.mediaKey;
            const meId = authState.creds.me.id;
            const node = encryptMediaRetryRequest(message.key, mediaKey, meId);
            let error = undefined;
            await Promise.all([
                sendNode(node),
                waitForMsgMediaUpdate(async (update) => {
                    const result = update.find(c => c.key.id === message.key.id);
                    if (result) {
                        if (result.error) {
                            error = result.error;
                        }
                        else {
                            try {
                                const media = decryptMediaRetryData(result.media, mediaKey, result.key.id);
                                if (media.result !== proto.MediaRetryNotification.ResultType.SUCCESS) {
                                    const resultStr = proto.MediaRetryNotification.ResultType[media.result];
                                    throw new Boom(`Media re-upload failed by device (${resultStr})`, {
                                        data: media,
                                        statusCode: getStatusCodeForMediaRetry(media.result) || 404
                                    });
                                }
                                content.directPath = media.directPath;
                                content.url = getUrlFromDirectPath(content.directPath, mediaHost);
                                logger.debug({ directPath: media.directPath, key: result.key }, 'media update successful');
                            }
                            catch (err) {
                                error = err;
                            }
                        }
                        return true;
                    }
                })
            ]);
            if (error) {
                throw error;
            }
            ev.emit('messages.update', [{ key: message.key, update: { message: message.message } }]);
            return message;
        },
        sendMessage: async (jid, content, options = {}) => {
            const userJid = authState.creds.me.id;
            if (typeof content === 'object' &&
                'disappearingMessagesInChat' in content &&
                typeof content['disappearingMessagesInChat'] !== 'undefined' &&
                isJidGroup(jid)) {
                const { disappearingMessagesInChat } = content;
                const value = typeof disappearingMessagesInChat === 'boolean'
                    ? disappearingMessagesInChat
                        ? WA_DEFAULT_EPHEMERAL
                        : 0
                    : disappearingMessagesInChat;
                await groupToggleEphemeral(jid, value);
            }
            else if (typeof content === 'object' && msgHandler.detectType(content)) {
                const type = msgHandler.detectType(content);
                const { quoted } = options;
                switch (type) {
                    case 'PAYMENT': {
                        const paymentContent = await msgHandler.handlePayment(content, quoted);
                        await relayMessage(jid, paymentContent, {
                            messageId: generateMessageIDV2(userJid),
                            quoted
                        });
                        return paymentContent;
                    }
                    case 'PRODUCT': {
                        const productContent = await msgHandler.handleProduct(content, jid, quoted);
                        const productMsg = await generateWAMessageFromContent(jid, productContent, { quoted, userJid });
                        await relayMessage(jid, productMsg.message, {
                            messageId: productMsg.key.id
                        });
                        return productMsg;
                    }
                    case 'ALBUM':
                        return await msgHandler.handleAlbum(content, jid, quoted);
                    case 'EVENT':
                        return await msgHandler.handleEvent(content, jid, quoted);
                    case 'ORDER':
                        return await msgHandler.handleOrderMessage(content, jid, quoted);
                    case 'GROUP_STATUS':
                        return await msgHandler.handleGroupStory(content, jid, quoted);
                    default:
                        throw new Boom(`Unhandled special content type: ${type}`);
                }
            }
            else {
                const fullMsg = await generateWAMessage(jid, content, {
                    logger,
                    userJid,
                    getUrlInfo: text => getUrlInfo(text, {
                        thumbnailWidth: linkPreviewImageThumbnailWidth,
                        fetchOpts: {
                            timeout: 3000,
                            ...(httpRequestOptions || {})
                        },
                        logger,
                        uploadImage: generateHighQualityLinkPreview ? waUploadToServer : undefined
                    }),
                    getProfilePicUrl: sock.profilePictureUrl,
                    getCallLink: sock.createCallLink,
                    upload: waUploadToServer,
                    mediaCache: config.mediaCache,
                    options: config.options,
                    messageId: generateMessageIDV2(sock.user?.id),
                    ...options
                });
                const isEventMsg = 'event' in content && !!content.event;
                const isDeleteMsg = 'delete' in content && !!content.delete;
                const isEditMsg = 'edit' in content && !!content.edit;
                const isPinMsg = 'pin' in content && !!content.pin;
                const isPollMessage = 'poll' in content && !!content.poll;
                const isAiMsg = 'ai' in content && !!content.ai;
                const additionalAttributes = {};
                const additionalNodes = [];
                if (isDeleteMsg) {
                    if (isJidGroup(content.delete?.remoteJid) && !content.delete?.fromMe) {
                        additionalAttributes.edit = '8';
                    }
                    else {
                        additionalAttributes.edit = '7';
                    }
                }
                else if (isEditMsg) {
                    additionalAttributes.edit = '1';
                }
                else if (isPinMsg) {
                    additionalAttributes.edit = '2';
                }
                else if (isAiMsg) {
                    if (!(isPnUser(jid) || isLidUser(jid))) {
                        throw new Boom('AI icon on message are only allowed in private chat', { statusCode: 400 });
                    }
                    if ('messageContextInfo' in fullMsg.message && !!fullMsg.message.messageContextInfo) {
                        fullMsg.message.messageContextInfo.supportPayload = BIZ_BOT_SUPPORT_PAYLOAD;
                    }
                    additionalNodes.push({
                        tag: 'bot',
                        attrs: { biz_bot: '1' },
                        content: undefined
                    });
                    delete content.ai;
                }
                else if (isPollMessage) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: { polltype: 'creation' }
                    });
                }
                else if (isEventMsg) {
                    additionalNodes.push({
                        tag: 'meta',
                        attrs: { event_type: 'creation' }
                    });
                }
                await relayMessage(jid, fullMsg.message, {
                    messageId: fullMsg.key.id,
                    useCachedGroupMetadata: options.useCachedGroupMetadata,
                    additionalAttributes,
                    statusJidList: options.statusJidList,
                    additionalNodes
                });
                if (config.emitOwnEvents) {
                    process.nextTick(async () => {
                        await messageMutex.mutex(() => upsertMessage(fullMsg, 'append'));
                    });
                }
                return fullMsg;
            }
        }
    };
};
