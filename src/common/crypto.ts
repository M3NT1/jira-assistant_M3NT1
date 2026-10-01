/**
 * Credential encryption helpers built on WebCrypto (AES-GCM).
 *
 * A random 256 bit key is generated per installation and kept in a dedicated
 * IndexedDB store, so exported backups or copies of the settings database do not
 * expose stored credentials in readable form. Values encrypted here are prefixed
 * with "enc1:"; anything without that prefix is treated as a legacy base64
 * (btoa) credential and decoded accordingly, which keeps old integrations working.
 *
 * The desktop app is the exception: it has always encrypted credentials through its
 * native encryptData / decryptData service, and keeps doing so. Its stored values carry
 * no prefix, so reading them as legacy base64 would break every existing app login.
 */

import { isAppBuild } from '../constants/build-info';

import { executeService } from './proxy';

const ENCRYPTED_PREFIX = 'enc1:';
const KEY_DB_NAME = 'ja-crypto';
const KEY_STORE_NAME = 'keys';
const KEY_ID = 'credential-key';

let cachedKey: Promise<CryptoKey> | undefined;

function openKeyDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(KEY_DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
                db.createObjectStore(KEY_STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function readStoredKey(db: IDBDatabase): Promise<JsonWebKey | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE_NAME, 'readonly');
        const request = tx.objectStore(KEY_STORE_NAME).get(KEY_ID);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function writeStoredKey(db: IDBDatabase, jwk: JsonWebKey): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(KEY_STORE_NAME, 'readwrite');
        const request = tx.objectStore(KEY_STORE_NAME).put(jwk, KEY_ID);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function loadOrCreateKey(): Promise<CryptoKey> {
    const db = await openKeyDb();

    try {
        const storedJwk = await readStoredKey(db);
        if (storedJwk) {
            return await crypto.subtle.importKey('jwk', storedJwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
        }

        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
        const jwk = await crypto.subtle.exportKey('jwk', key);
        await writeStoredKey(db, jwk);
        return key;
    } finally {
        db.close();
    }
}

function getKey(): Promise<CryptoKey> {
    if (!cachedKey) {
        cachedKey = loadOrCreateKey().catch((err) => {
            cachedKey = undefined;
            throw err;
        });
    }
    return cachedKey;
}

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });
    return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

export function isEncryptedCredential(value: string | undefined | null): boolean {
    // Desktop app values are natively encrypted and never need upgrading
    if (isAppBuild) {
        return !!value;
    }
    return !!value?.startsWith(ENCRYPTED_PREFIX);
}

export async function encryptText(plainText: string): Promise<string> {
    if (isAppBuild) {
        return executeService('SELF', 'encryptData', [plainText]);
    }

    const key = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainText));
    return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(cipher)}`;
}

export async function decryptText(storedValue: string): Promise<string> {
    if (isAppBuild) {
        return executeService('SELF', 'decryptData', [storedValue]);
    }

    if (!isEncryptedCredential(storedValue)) {
        // Legacy value stored with plain base64 encoding
        return atob(storedValue);
    }

    const [ivPart, cipherPart] = storedValue.substring(ENCRYPTED_PREFIX.length).split(':');
    const key = await getKey();
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(ivPart) as BufferSource },
        key,
        fromBase64(cipherPart) as BufferSource,
    );
    return new TextDecoder().decode(plain);
}
