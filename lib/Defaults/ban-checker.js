import { createHash } from 'crypto';

const WA_VERSION = '2.26.38.1';
const WA_VERSION_HASH = createHash('md5').update(WA_VERSION).digest('hex');

export const MOBILE_REGISTRATION_ENDPOINT = 'https://v.whatsapp.net/v2';
export const MOBILE_USERAGENT = `WhatsApp/${WA_VERSION} iOS/17.5.1 Device/Apple-iPhone_13`;
export const MOBILE_TOKEN = Buffer.from(
    '0a1mLfGUIBVrMKF1RdvLI5lkRBvof6vn0fD2QRSM' + WA_VERSION_HASH
);

export const MOBILE_COUNTRY_CODE = '';

export const GRAPHQL_ENDPOINT = 'https://graph.whatsapp.com/graphql';
export const GRAPHQL_ACCESS_TOKEN = 'WA|1015890928915437|3201f239340c1c8ec6262a6dad04200e';
export const GRAPHQL_BAN_STATUS_DOC_ID = '25573756098908502';
