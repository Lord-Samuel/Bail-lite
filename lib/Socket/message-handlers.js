import crypto from 'crypto';
import { proto } from '../../WAProto/index.js';
import {
    generateWAMessage,
    generateWAMessageContent,
    generateWAMessageFromContent,
    generateMessageID
} from '../Utils/index.js';

export class MessageHandler {
    constructor(waUploadToServer, relayMessageFn, getUserJid) {
        this.relayMessage = relayMessageFn;
        this.getUserJid = getUserJid;
        this.waUploadToServer = waUploadToServer;
    }

    detectType(content) {
        if (!content) return null;
        if (content.requestPaymentMessage) return 'PAYMENT';
        if (content.productMessage) return 'PRODUCT';
        if (content.albumMessage) return 'ALBUM';
        if (content.eventMessage) return 'EVENT';
        if (content.orderMessage) return 'ORDER';
        if (content.groupStatus) return 'GROUP_STATUS';
        return null;
    }

    async handlePayment(content, quoted) {
        const data = content.requestPaymentMessage || {};
        let noteMessage;
        if (data.sticker?.stickerMessage) {
            noteMessage = {
                stickerMessage: {
                    ...data.sticker.stickerMessage,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant,
                        quotedMessage: quoted?.message
                    }
                }
            };
        } else if (data.note) {
            noteMessage = {
                extendedTextMessage: {
                    text: data.note,
                    contextInfo: {
                        stanzaId: quoted?.key?.id,
                        participant: quoted?.key?.participant,
                        quotedMessage: quoted?.message
                    }
                }
            };
        }
        return {
            requestPaymentMessage: proto.Message.RequestPaymentMessage.fromObject({
                expiryTimestamp: data.expiry || 0,
                amount1000: data.amount || 0,
                currencyCodeIso4217: data.currency || 'IDR',
                requestFrom: data.from || '0@s.whatsapp.net',
                noteMessage,
                background: data.background
                    ? proto.Message.PaymentBackground.fromObject(data.background)
                    : undefined
            })
        };
    }

    async handleProduct(content) {
        const data = content.productMessage || {};
        let productImage;
        if (Buffer.isBuffer(data.thumbnail)) {
            const { imageMessage } = await generateWAMessageContent(
                { image: data.thumbnail },
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        } else if (data.thumbnail?.url) {
            const { imageMessage } = await generateWAMessageContent(
                { image: { url: data.thumbnail.url } },
                { upload: this.waUploadToServer }
            );
            productImage = imageMessage;
        }
        return {
            productMessage: {
                product: {
                    productImage,
                    productId: data.productId,
                    title: data.title,
                    description: data.description,
                    currencyCode: data.currencyCode || 'IDR',
                    priceAmount1000: data.priceAmount1000,
                    retailerId: data.retailerId,
                    url: data.url,
                    productImageCount: 1
                },
                businessOwnerJid: data.businessOwnerJid || '0@s.whatsapp.net',
                body: data.body || '',
                footer: data.footer || '',
                contextInfo: {}
            }
        };
    }

    async handleAlbum(content, jid, quoted) {
        const items = content.albumMessage || [];
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('handleAlbum: empty album');
        }

        const album = await generateWAMessageFromContent(jid, {
            messageContextInfo: { messageSecret: crypto.randomBytes(32) },
            albumMessage: {
                expectedImageCount: items.filter(a => a.hasOwnProperty('image')).length,
                expectedVideoCount: items.filter(a => a.hasOwnProperty('video')).length
            }
        }, {
            userJid: this.getUserJid?.() ?? jid,
            quoted,
            upload: this.waUploadToServer
        });

        await this.relayMessage(jid, album.message, { messageId: album.key.id });

        for (const item of items) {
            const img = await generateWAMessage(jid, item, {
                userJid: this.getUserJid?.(),
                upload: this.waUploadToServer
            });

            img.message.messageContextInfo = {
                messageSecret: crypto.randomBytes(32),
                messageAssociation: {
                    associationType: 1,
                    parentMessageKey: album.key
                }
            };

            const innerType = Object.keys(img.message)
                .find(k => /Message$/.test(k) && k !== 'messageContextInfo');
            if (innerType && img.message[innerType]) {
                img.message[innerType].contextInfo = {
                    ...(img.message[innerType].contextInfo || {}),
                    isForwarded: true,
                    forwardingScore: 999,
                    mentionedJid: [jid],
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '0@newsletter',
                        serverMessageId: 1,
                        newsletterName: 'WhatsApp',
                        contentType: 2
                    }
                };
            }

            await this.relayMessage(jid, img.message, {
                messageId: img.key.id,
                quoted: {
                    key: {
                        remoteJid: album.key.remoteJid,
                        id: album.key.id,
                        fromMe: true,
                        participant: jid
                    },
                    message: album.message
                }
            });
        }

        return album;
    }

    async handleEvent(content, jid, quoted) {
        const e = content.eventMessage || content.eventInvite || {};
        const num = (v, fallback) => {
            if (v instanceof Date) return v.getTime();
            if (typeof v === 'string') {
                const n = Number(v);
                if (!isNaN(n)) return n;
                const t = Date.parse(v); // ISO date strings
                return isNaN(t) ? fallback : t;
            }
            if (typeof v === 'number') return v;
            return fallback;
        };
    
        // eventInviteMessage wants Unix SECONDS, not milliseconds
        const nowSec = Math.floor(Date.now() / 1000);
        const toSec = (v, fallback) => {
            if (!v) return fallback;
            const n = num(v, fallback);
            // If it looks like ms (> 1e12), divide by 1000
            return n > 1e12 ? Math.floor(n / 1000) : n;
        };
    
        const startSec = toSec(e.startTime, nowSec + 300);
        const endSec = toSec(e.endTime, startSec + 3600);
    
        const msg = await generateWAMessageFromContent(jid, {
            eventInviteMessage: {
                eventId: e.eventId || `evt_${Date.now()}`,
                eventTitle: e.eventTitle || e.name || 'Event',
                startTime: startSec,
                endTime: endSec,
                caption: e.caption || e.description || '',
                isCanceled: !!e.isCanceled
            }
        }, { quoted });
    
        await this.relayMessage(jid, msg.message, { messageId: msg.key.id });
        return msg;
    }

    async handleOrderMessage(content, jid, quoted) {
        const o = content.orderMessage || {};
        const { OrderStatus, OrderSurface } = proto.Message.OrderMessage;
        const toEnum = (E, v, d) => (typeof v === 'number' ? v : (E[String(v).toUpperCase()] ?? d));
        const msg = await generateWAMessageFromContent(jid, {
            orderMessage: {
                orderId: o.orderId || `ORD-${Date.now()}`,
                thumbnail: o.thumbnail || undefined,
                itemCount: o.itemCount || 0,
                // proto enums must be numbers here: strings would encode as 0
                status: toEnum(OrderStatus, o.status, OrderStatus.ACCEPTED),
                surface: toEnum(OrderSurface, o.surface, OrderSurface.CATALOG),
                message: o.message,
                orderTitle: o.orderTitle,
                sellerJid: o.sellerJid || '0@s.whatsapp.net',
                token: o.token || 'REBIX_TOKEN',
                totalAmount1000: o.totalAmount1000 || 0,
                totalCurrencyCode: o.totalCurrencyCode || 'IDR',
                messageVersion: 2
            }
        }, { quoted });

        await this.relayMessage(jid, msg.message, { messageId: msg.key.id });
        return msg;
    }

    async handleGroupStory(content, jid, quoted) {
        const story = content.groupStatus || {};
        const s = crypto.randomBytes(32);

        let inner;
        if (story.message) {
            inner = story.message;
        } else if (story.extendedTextMessage || story.imageMessage || story.videoMessage) {
            inner = story;
        } else if (story.image || story.video) {
            const generated = await generateWAMessageContent(story, {
                upload: this.waUploadToServer
            });
            inner = generated.message || generated;
        } else {
            throw new Error('handleGroupStory: unrecognized story shape');
        }

        inner = {
            ...inner,
            messageContextInfo: {
                ...(inner.messageContextInfo || {}),
                messageSecret: s
            }
        };

        const msg = {
            message: {
                messageContextInfo: { messageSecret: s },
                groupStatusMessageV2: { message: inner }
            }
        };

        return this.relayMessage(jid, msg.message, {
            messageId: generateMessageID()
        });
    }
}
