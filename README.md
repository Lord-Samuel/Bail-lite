<div align="center">

# Bail-Lite

**A fast, lightweight WhatsApp Web library for Node.js.**
Pure ES modules. No browser. Multi-device. Built on the Baileys architecture.

![Node](https://img.shields.io/badge/node-%E2%89%A5%2020-3c873a)
![ESM](https://img.shields.io/badge/modules-ESM-f7df1e)
![Status](https://img.shields.io/badge/status-beta-orange)

[Quick start](#quick-start) · [Usage](#usage) · [Config](#configuration) · [Events](#events) · [Keep it running](#keep-it-running) · [FAQ](#faq)

</div>

---

## Quick start

**You need:** Node.js 20+, a project with `"type": "module"`, and a WhatsApp account to link.

```bash
npm install
```

```js
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from './lib/index.js'

async function start () {
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({ auth: state })

  sock.ev.on('creds.update', saveCreds)              // always save credentials

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) console.log('Scan the QR: WhatsApp > Linked devices > Link a device')
    if (connection === 'open') console.log('Connected')
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode
      if (code !== DisconnectReason.loggedOut) start()   // reconnect
      else console.log('Logged out. Delete ./auth and link again.')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe) continue
      await sock.sendMessage(msg.key.remoteJid, { text: 'Hello from Bail-Lite' })
    }
  })
}

start()
```

> Your import path depends on your build output (`./lib/index.js`, your package name, …).

**Prefer a pairing code over a QR?**

```js
if (!sock.authState.creds.registered) {
  const code = await sock.requestPairingCode('15551234567')   // digits only, with country code
  console.log('Enter this code in WhatsApp > Linked devices:', code)
}
```

> Seeing `stream errored out ... code 515` right after linking? That is normal.
> WhatsApp asks for one restart after pairing. The reconnect above handles it.

---

## Usage

`jid` = `15551234567@s.whatsapp.net` (person), `120363…@g.us` (group), or `…@lid`.

### Send

```js
await sock.sendMessage(jid, { text: 'Hello' })
await sock.sendMessage(jid, { text: 'Replying' }, { quoted: msg })
await sock.sendMessage(groupJid, { text: 'Hi @you', mentions: [userJid] })
await sock.sendMessage(groupJid, { text: 'Everyone!', mentionAll: true })
```

### Media

```js
await sock.sendMessage(jid, { image: { url: './pic.jpg' }, caption: 'Look' })
await sock.sendMessage(jid, { video: { url: './clip.mp4' }, caption: 'Clip' })
await sock.sendMessage(jid, { audio: { url: './voice.ogg' }, ptt: true })
await sock.sendMessage(jid, { document: { url: './file.pdf' }, mimetype: 'application/pdf', fileName: 'file.pdf' })
await sock.sendMessage(jid, { image: { url: './secret.jpg' }, viewOnce: true })
```

### React, edit, delete, forward

```js
await sock.sendMessage(jid, { react: { text: '\u{1F525}', key: msg.key } })   // any emoji, written as an escape
await sock.sendMessage(jid, { text: 'Fixed typo', edit: sentMsg.key })
await sock.sendMessage(jid, { delete: sentMsg.key })
await sock.sendMessage(otherJid, { forward: msg })
```

### Polls, contacts, location

```js
await sock.sendMessage(jid, { poll: { name: 'Lunch?', values: ['Pizza', 'Sushi', 'Salad'], selectableCount: 1 } })

await sock.sendMessage(jid, {
  contacts: { displayName: 'Alex', contacts: [{ vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Alex\nTEL;type=CELL:+15551234567\nEND:VCARD' }] }
})

await sock.sendMessage(jid, { location: { degreesLatitude: 40.7128, degreesLongitude: -74.0060 } })
```

### Receive and read

```js
sock.ev.on('messages.upsert', async ({ messages }) => {
  const msg = messages[0]
  const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text
  await sock.readMessages([msg.key])
})
```

### Download media you received

```js
import { downloadMediaMessage } from 'bail-lite'

const buffer = await downloadMediaMessage(msg, 'buffer', {})
```

### Groups

```js
const group = await sock.groupCreate('My group', [jid1, jid2])
const meta  = await sock.groupMetadata(group.id)
await sock.groupParticipantsUpdate(group.id, [jid3], 'add')        // 'add' | 'remove' | 'promote' | 'demote'
await sock.groupUpdateSubject(group.id, 'New name')
await sock.groupUpdateDescription(group.id, 'About this group')
const code = await sock.groupInviteCode(group.id)                  // https://chat.whatsapp.com/<code>
await sock.groupLeave(group.id)
```

### Look people up

```js
const [res]  = await sock.onWhatsApp('15551234567')      // is this number on WhatsApp?
const status = await sock.fetchStatus(jid)
const pfp    = await sock.profilePictureUrl(jid).catch(() => undefined)   // full size; 5s timeout
const ids    = await sock.findUserId(jid)                // { lid, phoneNumber }, undefined when unknown
```

### Also available

`communityCreate` · `newsletterCreate` / `newsletterFollow` / `newsletterMetadata` ·
`getBusinessProfile` / catalog & products · `updateBlockStatus` · `updateProfileName` /
`updateProfileStatus` / `updateProfilePicture` · `presenceSubscribe` / `sendPresenceUpdate` ·
`rejectCall` / `createCallLink` · `fetchPrivacySettings` · `chatModify` · `logout`

### Special message types

`albumMessage`, `eventMessage`, `orderMessage`, `productMessage`, `requestPaymentMessage`
and `groupStatus` are handled in `message-handlers.js`: open it for each one's exact shape.
`orderMessage` and `requestPaymentMessage` ship with placeholder defaults (currency `IDR`,
a placeholder seller JID and token), so always pass your own values.

---

## Login storage

| Store | Call | Best for |
| --- | --- | --- |
| Files | `useMultiFileAuthState('./auth')` | Getting started, single server. Writes are atomic. |
| SQLite | `useSqliteAuthState('./auth.db')` | One portable file. **Node 22.13+**. |
| MongoDB | `useMongoFileAuthState(collection)` | Multiple servers / containers. You create the collection. |

All three return `{ state, saveCreds }`. 

---

## Configuration

```js
const sock = makeWASocket({
  auth: state,
  browser: ['Bail-Lite', 'Chrome', '1.0.0'],
  markOnlineOnConnect: false,
  syncFullHistory: false,
  getMessage: async (key) => store.get(key)?.message,        // recommended, see below
  cachedGroupMetadata: async (jid) => groupCache.get(jid)    // recommended for busy bots
})
```

| Option | Default | What it does |
| --- | --- | --- |
| `auth` | none | **Required.** Your login state. |
| `version` | `Defaults/baileys-version.json` | WhatsApp Web version sent at login. |
| `browser` | macOS · Chrome | Name shown under Linked devices. |
| `logger` | pino | Any pino-compatible logger. |
| `markOnlineOnConnect` | `true` | Show as online when connected. |
| `syncFullHistory` | `true` | Request history on first link. |
| `emitOwnEvents` | `true` | Fire events for messages you send. |
| `connectTimeoutMs` / `keepAliveIntervalMs` | `20000` / `15000` | Socket timing. |
| `defaultQueryTimeoutMs` | `60000` | Timeout for server queries. |
| `maxMsgRetryCount` | `3` | Re-send attempts for undecryptable messages. |
| `generateHighQualityLinkPreview` | `true` | Upload a better link-preview image. |
| `getMessage` | returns nothing | Lets the library re-send a message when a recipient asks. |
| `cachedGroupMetadata` | returns nothing | Skips refetching group info on every send. |

**Why `getMessage` matters:** when someone cannot decrypt your message, WhatsApp asks you
to send it again. Without a way to look the message up, the retry fails and they see
"Waiting for this message".

---

## Events

```js
sock.ev.on('event.name', (payload) => { /* wrap async work in try/catch */ })
```

| Event | When |
| --- | --- |
| `connection.update` | Connect, disconnect, QR code |
| `creds.update` | Credentials changed → save them |
| `messages.upsert` | New messages (`type === 'notify'` for live ones) |
| `messages.update` · `messages.delete` · `messages.reaction` | Edits, receipts, deletes, reactions |
| `message-receipt.update` | Delivered / read receipts |
| `chats.upsert` · `chats.update` · `chats.delete` | Chat list |
| `contacts.upsert` · `contacts.update` | Contacts |
| `groups.upsert` · `groups.update` · `group-participants.update` | Groups |
| `group.join-request` | Someone asked to join a group |
| `presence.update` | Typing / online |
| `call` | Incoming calls |
| `blocklist.update` | Block list changed |
| `messaging-history.set` | History sync data |
| `newsletter.*` | Channel activity |
| `lid-mapping.update` | A phone ↔ LID mapping was learned |

> An error thrown inside an `async` handler is **not** caught for you. Use `try/catch`, or
> register with `sock.ev.process(handler)`, which logs errors instead of crashing.

---

## Keep it running

| Code | Name | What to do |
| --- | --- | --- |
| 515 | `restartRequired` | Normal after linking. Reconnect. |
| 408 / 428 | `timedOut` / `connectionClosed` | Reconnect. |
| 440 | `connectionReplaced` | Same login is running elsewhere. Stop the other copy. |
| 401 | `loggedOut` | Session ended. Delete the auth data and link again. |
| 500 | `badSession` | Auth data is corrupt. Link again. |
| 405 / instant close | outdated client | Update the WhatsApp Web version (below). |


## Ban checker

```js
const r = await sock.checkBanStatus('+15551234567')
r.status   // 'active' | 'banned' | 'blocked' | 'not_registered' | 'rate_limited' | 'unknown'
```

Options: `countryCode` (hint for numbers without a prefix), `diagnostic: true` (raw server
fields), `timeoutMs` (default 15000).

It queries WhatsApp's registration endpoint, so it is **unofficial** and can break at any
time. Check numbers gently: repeated lookups return `rate_limited`.

---

### Startup and stability

- **Syntax error fixed in `chat-utils.js`.** `processSyncAction` used `await` without being
  `async` and referenced a `keyStore` it never received, so the library could not load at all.
  It is now async and takes the key store as a parameter (`chats.js` passes `authState.keys`).
- **`Defaults/index.js`:** a `baileys-version.json` that parsed but had no valid `version` array
  left the config with no version. The file is now validated and the code always falls back
  (with a warning) to a built-in version.
- **Ban checker export:** the function is exported as `checkBanStatus` and imported under the
  same name, which fixes the startup error "does not provide an export named ...".
- **`socket.js`:** the pre-key upload timeout timer is now cleared instead of leaking.
- **Offline queue:** an unexpected error in one node no longer stalls the rest of the queue.
- **Retry limit:** an undefined `maxMsgRetryCount` silently removed the limit. It now defaults to 5.

### Sync, state and storage

- **App-state patches:** the version only advances after a patch decodes successfully. A patch
  that cannot be decoded now stops the run at the last good version (it is retried on the next
  sync) instead of being skipped, which guaranteed a hash mismatch for every later patch. Patch
  mutations are awaited, malformed index entries are skipped, and the snapshot content check
  reads the right field.
- **Event buffer:** `groups.update` events are merged instead of dropping all but the first;
  a pending `contacts.update` is folded into a later `contacts.upsert`; `messages.delete` with
  `all: true` is no longer swallowed while buffering; errors in `ev.process` handlers are logged
  instead of becoming unhandled rejections; a pending flush is cancelled when a new buffered
  call starts.
- **Auth transactions:** the commit loop always runs at least once (`maxCommitRetries: 0` used
  to drop data), and the cache is updated only after the store write succeeds.
- **Multi-file store:** writes go to a temp file and are renamed, so a crash cannot leave a
  truncated `creds.json`. Backslashes in key names are replaced (Windows path traversal).
- **MongoDB store:** arrays and strings (`device-list`, `lid-mapping`) are stored correctly,
  writes replace the whole document so removed fields do not linger, and database errors are
  raised instead of being treated as "no credentials" (which silently created a new identity).
- **SQLite store:** `synchronous = FULL` (the old setting could corrupt on power loss) and a
  correct Node version in the error message (22.13+).

### Messages and encryption

- **Registration ID:** it only used one random byte, giving 256 possible values. It now uses the
  full 14 bits.
- **Group (sender-key) ciphers:** a missing key state now throws "No session found to decrypt
  message" instead of returning `undefined` and failing later with a misleading error.
  Distribution messages are validated (32-byte chain key, 32 or 33-byte signing key), truncated
  messages are rejected, and a missing record no longer crashes `process` / `create`.
- **Sender-key race:** `processSenderKeyDistributionMessage` stored an empty record outside its
  transaction, which could overwrite a record another message had just saved. That write is gone.
- **Sender-key storage:** records are saved as base64 instead of byte arrays (about 3x smaller);
  old records still load.
- **Session migration (PN to LID):** an open LID session is no longer overwritten by an older PN
  session, and the cached device list is copied before it is modified.
- **Device selection:** `extractDeviceJids` compared the full `me.lid` JID against a bare user,
  so your own device could be included when results came back in LID form.
- **`process-message.js`:** `participantsIncludesMe` was missing a `return`, so chats were never
  marked read-only when you left a group. LID migration messages with a missing LID no longer
  store `undefined@lid`, and a missing participant is no longer turned into an empty string.
- **Decoding:** the broadcast branch also checks your LID, and non-Error throws no longer crash
  the failure handler.
- **Albums:** `userJid` is now your own JID (it was the recipient's, which broke group albums).
- **Events:** ISO date strings and `Date` objects are accepted for start and end times.
- **Order messages:** `status` and `surface` are sent as numeric enums (strings were encoded as
  0) and honour the values you pass.
- **Media:** a failed group-invite thumbnail no longer aborts the send; media re-upload now
  triggers on 404/410 (the code read `error.status`, which Boom errors do not have); temp files are
  removed even when an upload fails; a link preview for a page with no image no longer throws.
- **LID mapping:** swapped `lid` / `pn` arguments are no longer stored inverted, numbers with no
  LID are remembered for 5 minutes instead of triggering a USync request on every access, and a
  failed USync lookup returns whatever was already resolved instead of failing everything.

### Protocol layers

- **WABinary encoder:**
  - Text such as `constructor`, `toString` or `__proto__` was written as an empty string
    (`TOKEN_MAP` now has a null prototype).
  - Strings containing `@` were forced through the JID encoder, so `foo_bar@baz.com` became
    `foo@baz.com`. JID encodings are now used only when they round-trip exactly.
  - Non-string attributes produced a malformed frame. They are now left out.
- **WABinary decoder:** negative lengths fail fast instead of looping, and inflated frames are
  capped at 64 MB.
- **JID helpers:** `areJidsSameUser` no longer treats two missing JIDs as the same user, and the
  child-node lookup cache is rebuilt when children are added or replaced.
- **WAM encoder:** unknown event, global or property names throw clear errors (an unknown
  property used to be written as a junk field), missing `props` / `globals` default to empty, and
  the sequence number wraps at 16 bits.
- **USync:** the bot-profile parser no longer crashes the whole query, usernames are returned
  (they arrive as a Buffer), and the bot and LID protocols are exported.
- **Reporting tokens:** the varint decoder accepts values up to 10 bytes.
- **Pairing:** the HMAC check uses a constant-time comparison.

### Security hardening

- **Video thumbnails:** `ffmpeg` is run with an argument array (`execFile`) instead of a shell
  string, which removes a command-injection risk and fixes paths with spaces.
- **Media upload limit:** the maximum content length was counted twice per chunk.
- **Multi-file store:** see the path-traversal fix above.

### Ban checker

- The signed pre-key id is encoded as three bytes, as the real client does.
- An unparseable response is no longer reported as `active`.
- Requests time out after 15 seconds (`timeoutMs`), `canAppeal` is case-insensitive, country
  code `7` is recognised, and unused imports were removed.

### Chats, business and communities

- **`findUserId`:** returns `undefined` (not an empty string) when no mapping exists.
- **`updateCoverPhoto`:** the temp file is now deleted. `productCreate` no longer mutates the
  object you pass in.
- **Communities:** a missing node raises a proper error instead of a `TypeError`, group ids that
  already contain `@` are handled, and logging goes through your configured logger.
- **`browser-utils`:** `Browsers.custom` no longer crashes on unknown platforms.
- **`generics`:** `bindWaitForEvent` rejects when your check function throws instead of hanging,
  and `generateParticipantHashV2` no longer sorts your array in place.

### Behaviour changes to be aware of

- `newsletterFetchMessages` now takes `(type, key, count, after, before)` and returns decoded
  messages. `newsletterSubscribers` returns the raw query result.
- `profilePictureUrl` defaults to the full-size image and has a 5 second timeout, so it can now
  throw `Timed Out`.
- An unknown WAM event, global or property name now throws instead of writing bad data.
- Non-string XML attributes are dropped instead of being sent.
- Text messages with a link preview now get message type `url`.
- A MongoDB error at startup now throws instead of silently creating new credentials.

### Still open

- The sender-key cipher skips an iteration for every group message after the first.
- Media downloads are decrypted but the trailing MAC and file hash are not verified.
- `getHttpStream` ignores `timeout`, so there is no idle timeout on downloads.
- History sync is marked as processed before the download succeeds.
- One failed user in a devices or contacts query aborts that whole query.
- `saveIdentity` runs before a pre-key message is authenticated, so a delayed message carrying an
  older identity key can replace the stored one.

---

## Before you go live

- [ ] `auth/` (or your database) is in `.gitignore` and backed up
- [ ] `getMessage` is implemented
- [ ] Reconnect logic does **not** loop on `loggedOut` or `connectionReplaced`
- [ ] Any `{ url }` you send is **validated**: it can be a local file path or an internal
      address, so never pass raw user input
- [ ] `Defaults/ban-checker.js` (contains a client access token) is **not** in a public repo
- [ ] Handlers use `try/catch`
- [ ] You are on a number you can afford to lose while testing

---

## FAQ

**It connects, then closes immediately.**
The pinned version is probably outdated. See [Update the WhatsApp Web version](#update-the-whatsapp-web-version).

**"Waiting for this message" on the recipient's phone.**
Implement `getMessage` so retries can be served.

**`No session found to decrypt message` in a group.**
The sender's key has not reached you yet. WhatsApp usually resends it; if it persists, ask
them to send again.

**`does not provide an export named …` on startup.**
An export was renamed but an import still uses the old name. Make both sides match.

**`profilePictureUrl` throws `Timed Out`.**
It has a 5 second timeout and defaults to the full-size image. Catch the error, or pass
`'preview'` for the small one.

**SQLite store won't load.**
It needs Node 22.13+ (or `--experimental-sqlite` on 22.5 to 22.12).

**Will I get banned?**
Possibly. This is an unofficial client. Avoid bulk or unsolicited messaging, and don't
fabricate WhatsApp or business content (fake "forwarded from channel" labels, invented
orders or payment requests). Both are common ban triggers.

---

## Credits & license

Built on the work of the Baileys project and its contributors. Protocol details come from
reverse engineering WhatsApp Web and can change without notice. Not affiliated with
WhatsApp or Meta.

License: _add yours here_
