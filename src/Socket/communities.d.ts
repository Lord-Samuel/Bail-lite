import { proto } from '../../WAProto'
import { GroupMetadata, ParticipantAction, SocketConfig, ContactAction } from '../Types'
import { BinaryNode } from '../WABinary'

export declare const makeCommunitiesSocket: (config: SocketConfig) => {
    communityMetadata: (jid: string) => Promise<GroupMetadata>;
    communityCreate: (subject: string, body: string) => Promise<GroupMetadata | null>;
    communityLeave: (id: string) => Promise<void>;
    communityUpdateSubject: (jid: string, subject: string) => Promise<void>;
    communityRequestParticipantsList: (jid: string) => Promise<{
        [key: string]: string;
    }[]>;
    communityRequestParticipantsUpdate: (jid: string, participants: string[], action: "approve" | "reject") => Promise<{
        status: string;
        jid: string | undefined;
    }[]>;
    communityParticipantsUpdate: (jid: string, participants: string[], action: ParticipantAction) => Promise<{
        status: string;
        jid: string | undefined;
        content: BinaryNode;
    }[]>;
    communityUpdateDescription: (jid: string, description?: string) => Promise<void>;
    communityInviteCode: (jid: string) => Promise<string | undefined>;
    communityRevokeInvite: (jid: string) => Promise<string | undefined>;
    communityAcceptInvite: (code: string) => Promise<string | undefined>;
    /**
     * revoke a v4 invite for someone
     * @param communityJid community jid
     * @param invitedJid jid of person you invited
     * @returns true if successful
     */
    communityRevokeInviteV4: (communityJid: string, invitedJid: string) => Promise<boolean>;
    /**
     * accept a CommunityInviteMessage
     * @param key the key of the invite message, or optionally only provide the jid of the person who sent the invite
     * @param inviteMessage the message to accept
     */
    communityAcceptInviteV4: (key: string | WAMessageKey, inviteMessage: proto.Message.IGroupInviteMessage) => Promise<any>;
    communityGetInviteInfo: (code: string) => Promise<GroupMetadata>;
    communityToggleEphemeral: (jid: string, ephemeralExpiration: number) => Promise<void>;
    communitySettingUpdate: (jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked") => Promise<void>;
    communityMemberAddMode: (jid: string, mode: "admin_add" | "all_member_add") => Promise<void>;
    communityJoinApprovalMode: (jid: string, mode: "on" | "off") => Promise<void>;
    communityFetchAllParticipating: () => Promise<{
        [_: string]: GroupMetadata;
    }>;
    logger: import("../Utils/logger.js").ILogger;
    getOrderDetails: (orderId: string, tokenBase64: string) => Promise<import("../index.js").OrderDetails>;
    getCatalog: ({ jid, limit, cursor }: import("../index.js").GetCatalogOptions) => Promise<{
        products: import("../index.js").Product[];
        nextPageCursor: string | undefined;
    }>;
    getCollections: (jid?: string, limit?: number) => Promise<{
        collections: import("../index.js").CatalogCollection[];
    }>;
    productCreate: (create: import("../index.js").ProductCreate) => Promise<import("../index.js").Product>;
    productDelete: (productIds: string[]) => Promise<{
        deleted: number;
    }>;
    productUpdate: (productId: string, update: import("../index.js").ProductUpdate) => Promise<import("../index.js").Product>;
    sendMessageAck: ({ tag, attrs, content }: BinaryNode, errorCode?: number) => Promise<void>;
    sendRetryRequest: (node: BinaryNode, forceIncludeKeys?: boolean) => Promise<void>;
    rejectCall: (callId: string, callFrom: string) => Promise<void>;
    offerCall: (toJid: string, isVideo?: boolean) => Promise<{
        id: any
        to: string
    }>
    nodelogger: (node: BinaryNode) => Promise<void>
    fetchMessageHistory: (count: number, oldestMsgKey: WAMessageKey, oldestMsgTimestamp: number | import("long").default) => Promise<string>;
    requestPlaceholderResend: (messageKey: WAMessageKey) => Promise<string | undefined>;
    getPrivacyTokens: (jids: string[]) => Promise<any>;
    assertSessions: (jids: string[], force: boolean) => Promise<boolean>;
    relayMessage: (jid: string, message: proto.IMessage, { messageId: msgId, participant, additionalAttributes, additionalNodes, useUserDevicesCache, useCachedGroupMetadata, statusJidList }: import("../index.js").MessageRelayOptions) => Promise<string>;
    sendReceipt: (jid: string, participant: string | undefined, messageIds: string[], type: import("../index.js").MessageReceiptType) => Promise<void>;
    sendReceipts: (keys: WAMessageKey[], type: import("../index.js").MessageReceiptType) => Promise<void>;
    readMessages: (keys: WAMessageKey[]) => Promise<void>;
    refreshMediaConn: (forceGet?: boolean) => Promise<import("../index.js").MediaConnInfo>;
    waUploadToServer: import("../index.js").WAMediaUploadFunction;
    fetchPrivacySettings: (force?: boolean) => Promise<{
        [_: string]: string;
    }>;
    sendPeerDataOperationMessage: (pdoMessage: proto.Message.IPeerDataOperationRequestMessage) => Promise<string>;
    createParticipantNodes: (jids: string[], message: proto.IMessage, extraAttrs?: BinaryNode["attrs"]) => Promise<{
        nodes: BinaryNode[];
        shouldIncludeDeviceIdentity: boolean;
    }>;
    getUSyncDevices: (jids: string[], useCache: boolean, ignoreZeroDevices: boolean) => Promise<import("../index.js").JidWithDevice[]>;
    updateMediaMessage: (message: proto.IWebMessageInfo) => Promise<proto.IWebMessageInfo>;
    sendMessage: (jid: string, content: import("../index.js").AnyMessageContent, options?: import("../index.js").MiscMessageGenerationOptions) => Promise<proto.WebMessageInfo | undefined>;
    newsletterCreate: (name: string, description?: string) => Promise<import("../index.js").NewsletterMetadata>;
    newsletterUpdate: (jid: string, updates: import("../index.js").NewsletterUpdate) => Promise<unknown>;
    newsletterSubscribers: (jid: string) => Promise<{
        subscribers: number;
    }>;
    newsletterMetadata: (type: "invite" | "jid", key: string) => Promise<import("../index.js").NewsletterMetadata | null>;
    newsletterFollow: (jid: string) => Promise<unknown>;
    newsletterUnfollow: (jid: string) => Promise<unknown>;
    newsletterMute: (jid: string) => Promise<unknown>;
    newsletterUnmute: (jid: string) => Promise<unknown>;
    newsletterUpdateName: (jid: string, name: string) => Promise<unknown>;
    newsletterUpdateDescription: (jid: string, description: string) => Promise<unknown>;
    newsletterUpdatePicture: (jid: string, content: import("../index.js").WAMediaUpload) => Promise<unknown>;
    newsletterRemovePicture: (jid: string) => Promise<unknown>;
    newsletterReactMessage: (jid: string, serverId: string, reaction?: string) => Promise<void>;
    newsletterFetchMessages: (jid: string, count: number, since: number, after: number) => Promise<any>;
    subscribeNewsletterUpdates: (jid: string) => Promise<{
        duration: string;
    } | null>;
    newsletterAdminCount: (jid: string) => Promise<number>;
    newsletterChangeOwner: (jid: string, newOwnerJid: string) => Promise<void>;
    newsletterDemote: (jid: string, userJid: string) => Promise<void>;
    newsletterDelete: (jid: string) => Promise<void>;
    groupMetadata: (jid: string) => Promise<GroupMetadata>;
    groupCreate: (subject: string, participants: string[]) => Promise<GroupMetadata>;
    groupLeave: (id: string) => Promise<void>;
    groupUpdateSubject: (jid: string, subject: string) => Promise<void>;
    groupRequestParticipantsList: (jid: string) => Promise<{
        [key: string]: string;
    }[]>;
    groupRequestParticipantsUpdate: (jid: string, participants: string[], action: "approve" | "reject") => Promise<{
        status: string;
        jid: string | undefined;
    }[]>;
    groupParticipantsUpdate: (jid: string, participants: string[], action: ParticipantAction) => Promise<{
        status: string;
        jid: string | undefined;
        content: BinaryNode;
    }[]>;
    groupUpdateDescription: (jid: string, description?: string) => Promise<void>;
    groupInviteCode: (jid: string) => Promise<string | undefined>;
    groupRevokeInvite: (jid: string) => Promise<string | undefined>;
    groupAcceptInvite: (code: string) => Promise<string | undefined>;
    groupRevokeInviteV4: (groupJid: string, invitedJid: string) => Promise<boolean>;
    groupAcceptInviteV4: (key: string | WAMessageKey, inviteMessage: proto.Message.IGroupInviteMessage) => Promise<any>;
    groupGetInviteInfo: (code: string) => Promise<GroupMetadata>;
    groupToggleEphemeral: (jid: string, ephemeralExpiration: number) => Promise<void>;
    groupSettingUpdate: (jid: string, setting: "announcement" | "not_announcement" | "locked" | "unlocked") => Promise<void>;
    groupMemberAddMode: (jid: string, mode: "admin_add" | "all_member_add") => Promise<void>;
    groupJoinApprovalMode: (jid: string, mode: "on" | "off") => Promise<void>;
    groupFetchAllParticipating: () => Promise<{
        [_: string]: GroupMetadata;
    }>;
    getBotListV2: () => Promise<import("../index.js").BotListInfo[]>;
    processingMutex: {
        mutex<T>(code: () => Promise<T> | T): Promise<T>;
    };
    upsertMessage: (msg: import("../index.js").WAMessage, type: import("../index.js").MessageUpsertType) => Promise<void>;
    appPatch: (patchCreate: import("../index.js").WAPatchCreate) => Promise<void>;
    sendPresenceUpdate: (type: import("../index.js").WAPresence, toJid?: string) => Promise<void>;
    presenceSubscribe: (toJid: string, tcToken?: Buffer) => Promise<void>;
    profilePictureUrl: (jid: string, type?: "preview" | "image", timeoutMs?: number) => Promise<string | undefined>;
    onWhatsApp: (...jids: string[]) => Promise<{
        jid: string;
        exists: unknown;
        lid: unknown;
    }[] | undefined>;
    fetchBlocklist: () => Promise<(string | undefined)[]>;
    fetchStatus: (...jids: string[]) => Promise<import("../index.js").USyncQueryResultList[] | undefined>;
    fetchDisappearingDuration: (...jids: string[]) => Promise<import("../index.js").USyncQueryResultList[] | undefined>;
    updateProfilePicture: (jid: string, content: import("../index.js").WAMediaUpload, dimensions?: {
        width: number;
        height: number;
    }) => Promise<void>;
    removeProfilePicture: (jid: string) => Promise<void>;
    updateProfileStatus: (status: string) => Promise<void>;
    updateProfileName: (name: string) => Promise<void>;
    updateBlockStatus: (jid: string, action: "block" | "unblock") => Promise<void>;
    updateCallPrivacy: (value: import("../index.js").WAPrivacyCallValue) => Promise<void>;
    updateMessagesPrivacy: (value: import("../index.js").WAPrivacyMessagesValue) => Promise<void>;
    updateLastSeenPrivacy: (value: import("../index.js").WAPrivacyValue) => Promise<void>;
    updateOnlinePrivacy: (value: import("../index.js").WAPrivacyOnlineValue) => Promise<void>;
    updateProfilePicturePrivacy: (value: import("../index.js").WAPrivacyValue) => Promise<void>;
    updateStatusPrivacy: (value: import("../index.js").WAPrivacyValue) => Promise<void>;
    updateReadReceiptsPrivacy: (value: import("../index.js").WAReadReceiptsValue) => Promise<void>;
    updateGroupsAddPrivacy: (value: import("../index.js").WAPrivacyGroupAddValue) => Promise<void>;
    updateDefaultDisappearingMode: (duration: number) => Promise<void>;
    getBusinessProfile: (jid: string) => Promise<import("../index.js").WABusinessProfile | void>;
    resyncAppState: (collections: readonly ("critical_unblock_low" | "regular_high" | "regular_low" | "critical_block" | "regular")[], isInitialSync: boolean) => Promise<void>;
    chatModify: (mod: import("../index.js").ChatModification, jid: string) => Promise<void>;
    cleanDirtyBits: (type: "account_sync" | "groups", fromTimestamp?: number | string) => Promise<void>;
    addOrEditContact: (jid: string, contact: proto.SyncActionValue.IContactAction) => Promise<void>;
    removeContact: (jid: string) => Promise<void>;
    addLabel: (jid: string, labels: import("../Types/Label.js").LabelActionBody) => Promise<void>;
    addChatLabel: (jid: string, labelId: string) => Promise<void>;
    removeChatLabel: (jid: string, labelId: string) => Promise<void>;
    addMessageLabel: (jid: string, messageId: string, labelId: string) => Promise<void>;
    removeMessageLabel: (jid: string, messageId: string, labelId: string) => Promise<void>;
    star: (jid: string, messages: {
        id: string;
        fromMe?: boolean;
    }[], star: boolean) => Promise<void>;
    executeUSyncQuery: (usyncQuery: import("../index.js").USyncQuery) => Promise<import("../index.js").USyncQueryResult | undefined>;
    type: "md";
    ws: import("./Client/index.js").WebSocketClient;
    ev: import("../index.js").BaileysEventEmitter & {
        process(handler: (events: Partial<import("../index.js").BaileysEventMap>) => void | Promise<void>): () => void;
        buffer(): void;
        createBufferedFunction<A extends any[], T>(work: (...args: A) => Promise<T>): (...args: A) => Promise<T>;
        flush(force?: boolean): boolean;
        isBuffering(): boolean;
    };
    authState: {
        creds: import("../index.js").AuthenticationCreds;
        keys: import("../index.js").SignalKeyStoreWithTransaction;
    };
    signalRepository: import("../index.js").SignalRepository;
    user: import("../index.js").Contact | undefined;
    generateMessageTag: () => string;
    query: (node: BinaryNode, timeoutMs?: number) => Promise<any>;
    waitForMessage: <T>(msgId: string, timeoutMs?: number | undefined) => Promise<any>;
    waitForSocketOpen: () => Promise<void>;
    sendRawMessage: (data: Uint8Array | Buffer) => Promise<void>;
    sendNode: (frame: BinaryNode) => Promise<void>;
    logout: (msg?: string) => Promise<void>;
    end: (error: Error | undefined) => void;
    onUnexpectedError: (err: Error | import("@hapi/boom").Boom, msg: string) => void;
    uploadPreKeys: (count?: number) => Promise<void>;
    uploadPreKeysToServerIfRequired: () => Promise<void>;
    requestPairingCode: (phoneNumber: string, customPairingCode?: string) => Promise<string>;
    waitForConnectionUpdate: (check: (u: Partial<import("../index.js").ConnectionState>) => Promise<boolean | undefined>, timeoutMs?: number) => Promise<void>;
    sendWAMBuffer: (wamBuffer: Buffer) => Promise<any>;
};
export declare const extractCommunityMetadata: (result: BinaryNode) => GroupMetadata;
