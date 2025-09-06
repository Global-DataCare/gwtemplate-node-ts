// IMPORTANT! Install first 'react-native-randombytes' in react-native

/* Copyright (c) Conéctate Soluciones y Aplicaciones SL, Copyright (c) Connecting Solution & Applications Ltd. */
/* Apache License 2.0 */

// import sjcl from 'sjclplus';
import pako from 'pako';
// import { createRandomBytesAsBitArray } from '../crypto/security.manager';
import { AES_GCM_JWA_ENC } from '../aes/aes.model';
import { AESManager } from '../aes/aes.manager';
import { generateRandomBytesBase64UrlEncoded } from '../security/security.manager';
import { stringToUint8Array, bytesArrayToString, objectToRawBase64UrlSafe } from './convert';
import { JWEData, RecipientDataJWE, ProtectedHeadersJWE, UnprotectedHeadersJWE, StandardJWE } from './jwe.interface';

export const EncAlgoritmAES256GCM = 'aes-256-gcm';

const initVectorSize = 16;

export class JWEManager {
    constructor(){}

    /** It gets the recipient data by kid (JWK thumbprint), decrypts the CEK and then the message.
     *  The decrypted message can be both simple string or JSON.
     */
    /*
    async decryptByPrivateKyberKeyBytes(privateKeyBytes:Uint8Array, kid:string, jweData:StandardJWE, typ?:string): Promise<UnencryptedJWE> {
        return await decryptDataRecipient(privateKeyBytes, kid, jweData, typ);
    }
    */
   
    /** It returns empty string "" if some error or a concatenated string as per RFC7516 specification for only one recipient */
    public static compactDataJWE(jweData: JWEData | undefined): string {
        return compactDataJWE(jweData)
    }

    /** It returns empty string "" if some error or a concatenated string as per RFC7516 specification for only one recipient */
    public static async createCompactJWE(
        cekBase64Url: string,
        payloadData: object,
        recipient: RecipientDataJWE,
        protectHdersDecoded: ProtectedHeadersJWE,
        unprotectedHders?: UnprotectedHeadersJWE | undefined,
    ): Promise<string> {
        return await createCompactJWE(cekBase64Url, payloadData, recipient, protectHdersDecoded, unprotectedHders)
    }

    /** Create "ciphertext", "tag", "iv" (initialization vector, a nonce), "protected" (headers) and optional "unprotected" (headers) 
     *  but not "recipients" (it will be created by a parent function).
     *  @param cekBase64Url symmetric key for the data AES encryption.
     *  @param plaintextDataStringified stringified payload in case of a JWT.
     *  @param aadBase64Url the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
     *  @param ivBytesLength usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
     */
    public static async encryptDataJWE (
        cekBase64Url: string,               // symmetric key for the data AES encryption.
        plaintextDataStringified: string,   // stringified payload in case of a JWT.
        aadBase64Url: string,               // the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
        ivBytesLength? :number               // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
    ): Promise<JWEData> 
    {
        return encryptDataJWE(cekBase64Url, plaintextDataStringified, aadBase64Url, ivBytesLength)
    }
}

/** TODO: creates a compact JWE only for one recipient as per the OpenID specification
 *  It returns empty string "" if some error or a concatenated string as per RFC7516 specification for only one recipient
 *  It sets protectHeadersDecoded.enc = "A256GCM" and
 *  AAD = ASCII(Base64Url(protectHeadersDecoded)) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
 */
export async function createCompactJWE(
    cekBase64Url: string,
    payloadData: object,
    recipient: RecipientDataJWE,
    protectHdersDecoded: ProtectedHeadersJWE,
    unprotectedHders?: UnprotectedHeadersJWE | undefined,
): Promise<string> {
    const jweData = await createDataJWE(cekBase64Url, JSON.stringify(payloadData), protectHdersDecoded);
    // TODO: encrypt the cek for the recipient and set the recipient data in the JWE data
    return compactDataJWE(jweData)
}

/** Returns standard JWE in JSON format (one or more recipients) or undefined, but not compacted for a sole recipient
 *  It sets protectHeadersDecoded.enc = "A256GCM" and
 *  AAD = ASCII(Base64Url(protectHeadersDecoded)) as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
 */
export async function createDataJWE(
    cekBase64Url: string,
    plaintextData: string,
    protectHeadersDecoded: ProtectedHeadersJWE,
): Promise<StandardJWE | undefined> {
    // TODO: check the length of the CEK is 32 bytes

    // 11. If a "zip" parameter was included, compress the plaintext using the specified compression algorithm
    // and let M be the octet sequence representing the compressed plaintext;
    // otherwise, let M be the octet sequence representing the plaintext.
    let payloadBytes;
    try {
        payloadBytes = stringToUint8Array(plaintextData);
        if (protectHeadersDecoded.zip && protectHeadersDecoded.zip === 'DEF') {
            payloadBytes = pako.deflate(payloadBytes); // compress (deflate) the payload data bytes
        }
    } catch (e) {
        console.error(e);
        return undefined
    }

    // the plaintext represents the unencrypted payload's data bytes (compressed or not)
    const plaintextDataStringified = bytesArrayToString(payloadBytes);

    // 12. Create the JSON object(s) containing the desired set of Header Parameters, which together comprise the JOSE Header:
    // one or more of the JWE Protected Header, the JWE Shared Unprotected Header, and the JWE Per-Recipient Unprotected Header.

    // TODO: check protected header claim "enc" is "A256GCM"

    // 13. Compute the Encoded Protected Header value BASE64URL(UTF8(JWE Protected Header))
    protectHeadersDecoded.enc = AES_GCM_JWA_ENC; // A256GCM
    const protectedHderB64UrlSafe = objectToRawBase64UrlSafe(protectHeadersDecoded);

    // 14. Let the Additional Authenticated Data encryption parameter be ASCII(Encoded Protected Header)
    // as per https://www.rfc-editor.org/rfc/rfc7516#section-5.1
    const aadBase64Url = protectedHderB64UrlSafe

    // NIST 800-38D 8.2.2 (RGB Construction of IV) allows 128 bits to be randomly generated.
    const initVectorBytesLength: number = 16;

    // encrypt data
    // TODO: if recipients===1 do compact serialiation, if recipients>1 do JSON serialization
    let jweData = await encryptData(cekBase64Url, plaintextDataStringified, aadBase64Url)
    // jweData.protected = protectedHderB64UrlSafe;
    
    const standardJWE: StandardJWE = {
        protected: protectedHderB64UrlSafe, // jweData.protected,
        unprotected: jweData.unprotected,
        recipients: jweData.recipients as RecipientDataJWE[],
        iv: jweData.iv,
        ciphertext: jweData.ciphertext,
        tag: jweData.tag
    }
    return standardJWE // getCompactJWE(jweData)
}

/** It returns JWEData but recipients shall be created by the parent function.
 * cekBase64Url: symmetric key for the data AES encryption.
 * plaintextDataStringified: stringified payload in case of a JWT.
 * aadBase64Url: the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
 * ivBytesLength: usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
 * Note: scjl expects a UTF-8 data string (the "plaintext") instead of the data bytes
 */
async function encryptData (
    cekBase64Url:   string, // symmetric key for the data AES encryption.
    plaintextData:  string, // stringified payload in case of a JWT.
    aadBase64Url:   string, // the JWE `recipients` encoded in Base64Url when using the JWE JSON Serialization (multiple recipients/participants).
    ivBytesLength?  :number // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
): Promise<JWEData> 
{
    // Creating the random data: the "iv" and encrypting
    // const nonceBitArray = createRandomBytesAsBitArray(ivBytesLength); // NIST 800.D allows 16 bytes length instead of the default 12 bytes
    const nonceBase64Url = await generateRandomBytesBase64UrlEncoded(ivBytesLength || 16) // NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits) sjcl.codec.base64url.fromBits(nonceBitArray);
    const ctAndTagBase64Url = await AESManager.encryptAESGCM(cekBase64Url, plaintextData, aadBase64Url, nonceBase64Url);

    // Separate ciptertext/tag combination
    return await AESManager.getProtectedDataForJWE(nonceBase64Url, ctAndTagBase64Url) as JWEData;
}

/** Create "ciphertext", "tag", "iv" (initialization vector, a nonce), "protected" (headers) and optional "unprotected" (headers) 
 *  but not "recipients" (it will be created by a parent function).
 *  In the JWE JSON Serialization, a JWE is represented as a JSON object containing some or all of these eight members:
 *  - "protected", with the value BASE64URL(UTF8(JWE Protected Header))
 *  - "unprotected", with the value JWE Shared Unprotected Header
 *  - "recipients", array of JSON objects where each object contains information specific to a single recipient, but all all Header Parameter values are shared between all recipients.
 *  - "iv" is the value BASE64URL(JWE Initialization Vector)
 *  - "ciphertext" is the value BASE64URL(JWE Ciphertext)
 *  - "tag" is the value BASE64URL(JWE Authentication Tag)
 *  - "aad" is the DOUBLE Base64Url encoding value of the JWE Protected Headers: BASE64URL(JWE AAD) = BASE64URL( ASCII(BASE64URL(UTF8(JWE Protected Header))) )
 *  (see the AAD example at https://www.rfc-editor.org/rfc/rfc7516#section-3.3)
 *  @param cekBase64Url symmetric key for the data AES encryption.
 *  @param plaintextDataStringified stringified payload in case of a JWT.
 *  @param aadBase64Url the Additional Authenticated Data encryption parameter (AAD) protects the integrity of the JWE Protected Header (double Base64Url encoded as per the specification).
 *  @param ivBytesLength usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
 */
export async function encryptDataJWE (
    cekBase64Url: string,               // symmetric key for the data AES encryption.
    plaintextDataStringified: string,   // stringified payload in case of a JWT.
    aadBase64Url: string,               // NOTE: double Base64Url encoding: BASE64URL(JWE AAD) = BASE64URL( ASCII(BASE64URL(UTF8(JWE Protected Header))) )
    ivBytesLength? :number              // usually 12 bytes (96 bits) but NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
): Promise<JWEData> 
{
    if (!ivBytesLength) ivBytesLength = 16; // NIST 800-38D 8.2.2 (RGB Construction of IV) allows to be 16 bytes (128 bits)
    return encryptData(cekBase64Url, plaintextDataStringified, aadBase64Url, ivBytesLength)
}

/** It returns the JWE's plaintext decrypted data but not a JSON object */
export async function decryptDataJWE(cekBase64Url: string, jweData: JWEData): Promise<string> {
    const plaintextData = await AESManager.decryptProtectedDataJWE(
        cekBase64Url,
        jweData.ciphertext as string,
        jweData.protected, // protected headers (for the AES "AAD")
        jweData.iv as string,
        jweData.tag as string
    );

    return plaintextData; // it can be a JSON strified string
}

/** The Compact Serialization of this result is an empty string "" if some error or the concatenation string
 *  BASE64URL(UTF8(JWE Protected Header)) || '.' || 
 *  BASE64URL(JWE Encrypted Key) || '.' ||
 *  BASE64URL(JWE Initialization Vector) || '.' ||
 *  BASE64URL(JWE Ciphertext) || '.' ||
 *  BASE64URL(JWE Authentication Tag).
 */
export function compactDataJWE(jweData: StandardJWE | undefined): string {
    if (!jweData || !jweData.recipients || !jweData.recipients.length || jweData.recipients.length<1
        || !jweData.protected || !jweData.iv || !jweData.ciphertext || !jweData.tag ) {
        return ""
    } else {
        return jweData.protected as string + "." +
        jweData.recipients[0].encrypted_key as string + "." +
        jweData.iv + "." + jweData.ciphertext + "." + jweData.tag
    }
}

/** Gets recipient data by recipient's keyID (kid) */
export function getRecipientDataByKeyID(recipientsList: RecipientDataJWE[], kid: string): RecipientDataJWE | undefined{
    let result;
    if (recipientsList && recipientsList.length && recipientsList.length > 0) {
        const recipientFound = recipientsList.some(
            (recipient: RecipientDataJWE) => {
                if (recipient.header && recipient.header.kid && recipient.header.kid === kid) {
                    result = recipient;
                    return true;
                }
            }
        );
    }
    return result;
}

/** It gets the recipient data by kid (JWK thumbprint), decrypts the CEK and then the message.
 *  The decrypted message can be both simple string or JSON.
 */
/*
export async function decryptDataRecipient(privateKeyBytes:Uint8Array, kid:string, jweData:StandardJWE, typ?:string): Promise<UnencryptedJWE> {
    if (!privateKeyBytes || !kid) {
        throw new Error(`the recipient's private key (bytes) and the public 'kid' (public keyID by thumbprint) are required`);
    }

    // getting the recipient data by kid
    if (!jweData || !jweData.recipients || !jweData.recipients.length || jweData.recipients.length<1){
        throw new Error('no recipients found');
    }
    let kidRecipient = {} as RecipientDataJWE;
    const recipientFound = jweData.recipients.some(
        (recipient: RecipientDataJWE) => {
            if (recipient.header && recipient.header.kid && recipient.header.kid === kid) {
                kidRecipient = recipient;
                return true;
            }
        }
    );
    if (!recipientFound){
        throw new Error('recipient kid not found');
    }
    if (!kidRecipient.encrypted_key){
        throw new Error(`missing key for recipient kid ${kid}`);
    }

    // decrypt or decapsulate the CEK by the UHC supported algorithm used for the recipient (Kyber-768 or X25519)
    if (!kidRecipient.header.alg){
        throw new Error(`missing key for recipient kid ${kid}`);
    }

    const encapsulatedSymmetricKeyBytes: Uint8Array = ContentUtils.base64ToBytes(kidRecipient.encrypted_key);
    let cekBytes: Uint8Array;
    switch(kidRecipient.header.alg) {
        case('Kyber-768'): {
            cekBytes = await decapsulateBy768(encapsulatedSymmetricKeyBytes, privateKeyBytes);
            break;
        }
        case('X25519'): {
            throw new Error ('algoritim X25519 not implemented');
        }
        default: {
            throw new Error (`algorithm "${kidRecipient.header.alg}" not supported`);
        }
    }
    
    const cekBase64Url = bytesToRawBase64UrlSafe(cekBytes)

    // checking AES 'A256GCM' encryption ('enc') header and 'typ' header
    const jweProtectedDataJSON = ContentUtils.base64ToObject(jweData.protected) as ProtectedHeadersJWE;
    if (!jweProtectedDataJSON || !jweProtectedDataJSON.enc || jweProtectedDataJSON.enc !== 'A256GCM') {
        throw new Error('invalid AES GCM encryption header');
    }
    if (typ) {
        console.log('content protected header "typ" = ', jweProtectedDataJSON.typ);
        if (!jweProtectedDataJSON.typ || jweProtectedDataJSON.typ !== typ) {
            throw new Error(`content header typ "${typ}" not found`);
        }
    }

    let decryptedData = decryptDataJWE(cekBase64Url, jweData);

    // creating the output
    const unencryptedJWE: UnencryptedJWE = {
        protectHdersDecoded: ContentUtils.base64ToObject(jweData.protected) as ProtectedHeadersJWE,
        // recipient: kidRecipient, // it is not available in the unencrypted data
        plaintext: decryptedData,
        recipients: []
    };
    if (jweData.unprotected) {
        unencryptedJWE.unprotected = jweData.unprotected;
    }

    return unencryptedJWE;
}
*/

/*
export function jsonMessageByJWE(jwe: StandardJWE, privateKeyBytes: Uint8Array): object {
    var dcipher = createDecipheriv(algorithm, privateKeyBytes, iv);
    dcipher.setAAD(Buffer.from(toASCII(jweTokenParts[0])));
    dcipher.setAuthTag(Buffer.from(chipherTextAuthTagHex, 'base64'));
    var planText = dcipher.update(chipperTextHex, 'base64', 'utf8');
    planText += dcipher.final('utf8');
    console.log(planText);
}
*/


/** It gets the recipient data by kid (JWK thumbprint), decrypts the CEK and then the message.
 *  The decrypted message can be both simple string or JSON.
 */
/*
export async function cekDecryptBytes(jsonJWE:StandardJWE, privateKeyBytes:Uint8Array, kid:string, typ?:string): Promise<Uint8Array> {
    if (!privateKeyBytes || !kid) {
        throw new Error(`the recipient's private key (bytes) and the public 'kid' (public keyID by thumbprint) are required`);
    }

    // getting the recipient data by kid
    if (!jsonJWE || !jsonJWE.recipients || !jsonJWE.recipients.length || jsonJWE.recipients.length<1){
        throw new Error('no recipients found');
    }
    let kidRecipient = {} as RecipientDataJWE;
    const recipientFound = jsonJWE.recipients.some(
        (recipient: RecipientDataJWE) => {
            if (recipient.header && recipient.header.kid && recipient.header.kid === kid) {
                kidRecipient = recipient;
                return true;
            }
        }
    );
    if (!recipientFound){
        throw new Error('recipient kid not found');
    }
    if (!kidRecipient.encrypted_key){
        throw new Error(`missing key for recipient kid ${kid}`);
    }

    // decrypt or decapsulate the CEK by the UHC supported algorithm used for the recipient (Kyber-768 or X25519)
    if (!kidRecipient.header.alg){
        throw new Error(`missing key for recipient kid ${kid}`);
    }

    const encapsulatedSymmetricKeyBytes: Uint8Array = base64OrUrlSafeToBytes(kidRecipient.encrypted_key);
}
*/