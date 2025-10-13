// __tests__/full-pki-chain.test.ts

// Author: Fernando Latorre López
// License: Apache License 2.0 (see LICENSE)
// This code is part of a trusted infrastructure project and is provided "as is", without warranty of any kind.
// You are responsible for verifying that it meets your security and compliance requirements.
// Commercial or derivative reuse outside the original infrastructure context requires prior written consent from the author.

import fs from 'fs';
import { Crypto } from '@peculiar/webcrypto';
import {
  deriveKeyPair,
  createCertificate,
  bufferToPem,
  EntityConfig,
  generateMSPID,
  saveJwkDidAndSD,
  resolveOutputDir
} from '../../utils/pki-utils';
import { bytesToHex } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';

const crypto = new Crypto();
const subtle = crypto.subtle;

describe('🔐 PKI Chain Test', () => {
    // Configuration
    const OUTPUT_BASE = 'artifacts';

    const peerHost = 'peer0.anchor1.example.com';
    const peerPort = 7051;
    const rootCertFile = 'root-cert.pem';
    const icaCertFile = 'ica-cert.pem';
    
    const rootCA: EntityConfig = {
        legalRegistrationNumber: 'VATESG02793479',
        domain: 'root-ca.unid.es',
        subjectCN: 'UNID Root CA',
        org: 'Fundación UNID',
        jurisdiction: 'ES',
        location: { city: 'Soria', street: 'Calle Condes de Gómara, 6', postalCode: '42002' },
        seed: '', // random
    };

    const ica: EntityConfig = {
        legalRegistrationNumber: 'VATESB42215152',
        domain: 'ica.connecthealth.info',
        subjectCN: 'UNID Intermediate CA',
        org: 'Conéctate Soluciones y Aplicaciones S.L.',
        jurisdiction: 'ES',
        location: { city: 'Soria', street: 'Calle Condes de Gómara, 6', postalCode: '42002' },
        seed: '', // random
    };

    const gateways: EntityConfig[] = [{
        legalRegistrationNumber: 'VATES-CITY01',
        domain: 'employees-gw.ciudad1.es',
        subjectCN: 'Employees Gateway - Ciudad 1',
        org: 'Ayuntamiento Ciudad 1',
        jurisdiction: 'ES',
        location: { city: 'Ciudad 1', street: 'Plaza Mayor 1', postalCode: '11001' },
        seed: '', // random
    },
    {
        legalRegistrationNumber: 'VATES-CITY01',
        domain: 'customers-gw.ciudad1.es',
        subjectCN: 'Customers Gateway - Ciudad 1',
        org: 'Ayuntamiento Ciudad 1',
        jurisdiction: 'ES',
        location: { city: 'Ciudad 1', street: 'Plaza Mayor 1', postalCode: '11001' },
        seed: '', // random
    }];

    let rootKey: CryptoKey;
    let rootCert: Buffer;
    let icaKey: CryptoKey;
    let icaCert: Buffer;

    test('Generate Root CA', async () => {
        const { pub, jwk, seed, kid } = await deriveKeyPair(rootCA.seed);
        console.log(`🔐 Root CA Seed: ${seed}`);
        console.log(`🆔 Root CA kid: ${kid}`);
        rootKey = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
        rootCert = await createCertificate(rootCA.subjectCN, rootCA.subjectCN, rootKey, rootKey, pub, 10, rootCA.legalRegistrationNumber);
        const pem = bufferToPem(rootCert, 'CERTIFICATE');
        const outputDir = resolveOutputDir(rootCA.domain);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(`${outputDir}/${rootCertFile}`, pem);
        fs.writeFileSync(`${outputDir}/root-private-jwk.json`, JSON.stringify(jwk, null, 2));
        await saveJwkDidAndSD(rootCA, jwk, kid, outputDir, 'TrustAnchor', ['Trust Infrastructure']);
        
        const derCert = pem.toString().replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\n/g, '');
        const certBytes = Buffer.from(derCert, 'base64');
        const hash = sha256(certBytes);
        console.log(`📌 CA Root Fingerprint (SHA-256): ${bytesToHex(hash)}`);
    });

    test('Generate ICA', async () => {
        const { pub, jwk, seed, kid } = await deriveKeyPair(ica.seed);
        console.log(`🔐 ICA Seed: ${seed}`);
        console.log(`🆔 ICA kid: ${kid}`);
        icaKey = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
        icaCert = await createCertificate(ica.subjectCN, rootCA.subjectCN, icaKey, rootKey, pub, 5, ica.legalRegistrationNumber);

        const outputDir = resolveOutputDir(ica.domain);
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(`${outputDir}/${icaCertFile}`, bufferToPem(icaCert, 'CERTIFICATE'));
        fs.writeFileSync(`${outputDir}/ica-private-jwk.json`, JSON.stringify(jwk, null, 2));
        await saveJwkDidAndSD(ica, jwk, kid, outputDir, 'TrustAnchor', ['Trust Infrastructure']);
    });

    test('Generate Gateways', async () => {
        for (const gw of gateways) {
            const { pub, jwk, seed, kid } = await deriveKeyPair(gw.seed);
            console.log(`🔐 Gateway ${gw.domain} Seed: ${seed}`);
            console.log(`🆔 Gateway ${gw.domain} kid: ${kid}`);
            const privKey = await subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
            const cert = await createCertificate(gw.subjectCN, ica.subjectCN, privKey, icaKey, pub, 2, gw.legalRegistrationNumber);
            const mspid = generateMSPID(gw);
            const outputDir = resolveOutputDir(`msp-${mspid}`);

            fs.mkdirSync(`${outputDir}/keystore`, { recursive: true });
            fs.mkdirSync(`${outputDir}/signcerts`, { recursive: true });
            fs.mkdirSync(`${outputDir}/cacerts`, { recursive: true });
            fs.mkdirSync(`${outputDir}/intermediatecerts`, { recursive: true });

            fs.writeFileSync(`${outputDir}/keystore/private-jwk.json`, Buffer.from(JSON.stringify(jwk)));
            fs.writeFileSync(`${outputDir}/signcerts/cert.pem`, bufferToPem(cert, 'CERTIFICATE'));
            fs.writeFileSync(`${outputDir}/cacerts/${icaCertFile}`, icaCert);
            fs.writeFileSync(`${outputDir}/intermediatecerts/${rootCertFile}`, rootCert);

            fs.writeFileSync(`${outputDir}/config.yaml`, `
                NodeOUs:
                Enable: true
                ClientOUIdentifier:
                    OrganizationalUnitIdentifier: client
                    Certificate: cacerts/${icaCertFile}`
            .trimStart());

            fs.writeFileSync(`${outputDir}/connection-profile.yaml`, `
                name: ${gw.subjectCN}
                version: 1.0.0
                client:
                organization: ${mspid}
                credentialStore:
                    path: ./${outputDir}
                    cryptoStore:
                    path: ./${outputDir}
                organizations:
                ${mspid}:
                    mspid: ${mspid}
                    cryptoPath: ./${outputDir}
                    certificateAuthorities:
                    - ca.${ica.domain}
                peers:
                ${peerHost}:
                    url: grpcs://${peerHost}:${peerPort}
                    tlsCACerts:
                    path: ./${outputDir}/intermediatecerts/${rootCertFile}
                    grpcOptions:
                    ssl-target-name-override: ${peerHost}
                certificateAuthorities:
                ca.${ica.domain}:
                    url: https://${ica.domain}:7054
                    caName: ca.${ica.domain}
                    tlsCACerts:
                    path: ./${outputDir}/cacerts/${icaCertFile}`
            .trimStart());

            await saveJwkDidAndSD(gw, jwk, kid, outputDir, 'DataConsumer', ['Public Services']);
        }
    });
});
