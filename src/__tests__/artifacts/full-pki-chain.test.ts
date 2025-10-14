import { writeFileSync, mkdirSync } from 'fs';
import { Crypto } from '@peculiar/webcrypto';
import {
  deriveKeyPair,
  createCertificate,
  bufferToPem,
  AuthorityConfig,
  generateMSPID,
  saveJwkDidAndCredential,
  resolveOutputDir
} from '../../utils/pki';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { TEST_PARTICIPANT } from '../data/participant';

const crypto = new Crypto();
const subtle = crypto.subtle;

describe('🔐 PKI Chain Test', () => {
    // Configuration
    const FILE_PREFIX = 'full-pki-chain';
    const rootCertFile = 'root-cert.pem';
    const icaCertFile = 'ica-cert.pem';
    
    const rootCA: AuthorityConfig = {
        legalRegistrationNumber: TEST_PARTICIPANT.VAT_ID,
        domain: `root-ca.${TEST_PARTICIPANT.WEB_DOMAIN}`,
        subjectCN: `${TEST_PARTICIPANT.COMMON_NAME} Root CA`,
        officialName: TEST_PARTICIPANT.OFFICIAL_NAME,
        countryCode: TEST_PARTICIPANT.COUNTRY_CODE,
        location: { city: 'Soria' },
        seed: '', // random
    };

    const ica: AuthorityConfig = {
        legalRegistrationNumber: TEST_PARTICIPANT.VAT_ID,
        domain: `ica.${TEST_PARTICIPANT.WEB_DOMAIN}`,
        subjectCN: `${TEST_PARTICIPANT.COMMON_NAME} Intermediate CA`,
        officialName: TEST_PARTICIPANT.OFFICIAL_NAME,
        countryCode: TEST_PARTICIPANT.COUNTRY_CODE,
        location: { city: 'Soria' },
        seed: '', // random
    };

    const gateways: AuthorityConfig[] = [{
        legalRegistrationNumber: 'VATES-CITY01',
        domain: `employees-gw.ciudad1.es`,
        subjectCN: 'Employees Gateway - Ciudad 1',
        officialName: 'Ayuntamiento Ciudad 1',
        countryCode: 'ES',
        location: { city: 'Ciudad 1' },
        seed: '', // random
    }];

    let rootKey: CryptoKey;
    let rootCert: Buffer;
    let icaKey: CryptoKey;
    let icaCert: Buffer;

    test('Generate Root CA', async () => {
        const { pub, jwk, seed, kid } = await deriveKeyPair(rootCA.seed as string);
        rootKey = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
        rootCert = await createCertificate(rootCA.subjectCN, rootCA.subjectCN, rootKey, rootKey, pub, 10, rootCA.legalRegistrationNumber);
        
        const outputDir = resolveOutputDir(`${FILE_PREFIX}-root-ca`);
        writeFileSync(`${outputDir}/${rootCertFile}`, bufferToPem(rootCert, 'CERTIFICATE'));
        writeFileSync(`${outputDir}/private-jwk.json`, JSON.stringify(jwk, null, 2));
        await saveJwkDidAndCredential(rootCA, jwk, kid, outputDir);
        
        const derCert = bufferToPem(rootCert, 'CERTIFICATE').toString().replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\\n/g, '');
        const certBytes = Buffer.from(derCert, 'base64');
        const hash = sha256(certBytes);
        console.log(`📌 CA Root Fingerprint (SHA-256): ${bytesToHex(hash)}`);
    });

    test('Generate ICA', async () => {
        const { pub, jwk, seed, kid } = await deriveKeyPair(ica.seed as string);
        icaKey = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
        icaCert = await createCertificate(ica.subjectCN, rootCA.subjectCN, icaKey, rootKey, pub, 5, ica.legalRegistrationNumber);

        const outputDir = resolveOutputDir(`${FILE_PREFIX}-ica`);
        writeFileSync(`${outputDir}/${icaCertFile}`, bufferToPem(icaCert, 'CERTIFICATE'));
        writeFileSync(`${outputDir}/private-jwk.json`, JSON.stringify(jwk, null, 2));
        await saveJwkDidAndCredential(ica, jwk, kid, outputDir);
    });

    test('Generate Gateways', async () => {
        for (const gw of gateways) {
            const { pub, jwk, seed, kid } = await deriveKeyPair(gw.seed as string);
            const privKey = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
            const cert = await createCertificate(gw.subjectCN, ica.subjectCN, privKey, icaKey, pub, 2, gw.legalRegistrationNumber);
            
            const mspid = generateMSPID(gw);
            const outputDir = resolveOutputDir(`${FILE_PREFIX}-msp-${mspid}`);

            mkdirSync(`${outputDir}/keystore`, { recursive: true });
            mkdirSync(`${outputDir}/signcerts`, { recursive: true });
            mkdirSync(`${outputDir}/cacerts`, { recursive: true });
            mkdirSync(`${outputDir}/intermediatecerts`, { recursive: true });

            writeFileSync(`${outputDir}/keystore/private-jwk.json`, Buffer.from(JSON.stringify(jwk)));
            writeFileSync(`${outputDir}/signcerts/cert.pem`, bufferToPem(cert, 'CERTIFICATE'));
            writeFileSync(`${outputDir}/cacerts/${rootCertFile}`, bufferToPem(rootCert, 'CERTIFICATE'));
            writeFileSync(`${outputDir}/intermediatecerts/${icaCertFile}`, bufferToPem(icaCert, 'CERTIFICATE'));

            await saveJwkDidAndCredential(gw, jwk, kid, outputDir);
        }
    });
});
