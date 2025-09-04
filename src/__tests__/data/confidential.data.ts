// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/data/confidential.data.ts

/**
 *  https://identity.foundation/confidential-storage/#structureddocument
*/
export const testConfidentialStorageDoc1 = {
    "id":"z19x9iFMnfo4YLsShKAvnJk4L",
    "sequence":0,
    "content": {
        /** e.g. the resource object (an entry in the "data" array received from a bathc job) with resource.meta.claims
         *  and additional data vault configuration: https://identity.foundation/confidential-storage/#example-1-example-data-vault-configuration
         *  in case of organization (such as hmac and didDocument)
        */
        didDocument: {
        },
        hmac: {
            "id": "https://example.com/kms/67891",
            "type": "Sha256HmacKey2019"
        },
        resource: {meta: { claims: {}}},
    },
    "indexed":[{
        "attributes": [{
            "name": "CUQaxPtSLtd8L3WBAIkJ4DiVJeqoF6bdnhR7lSaPloZ", // HMAC (e.g. the host's HMAC for the tenants, or the tenant's KMS for the employees)
            "value": "RV58Va4904K-18_L5g_vfARXRWEB00knFSGPpukUBro",
            "unique": true
        }, {
            "name": "DUQaxPtSLtd8L3WBAIkJ4DiVJeqoF6bdnhR7lSaPloZ",
            "value": "QV58Va4904K-18_L5g_vfARXRWEB00knFSGPpukUBro"
        }],
        "hmac":{
            "id":"did:ex:12345#key1",
            "type":"Sha256HmacKey2019"
        },
        "sequence":0,
    }],
    "jwe":{
        "protected":"eyJlbmMiOiJDMjBQIn0",
        "recipients":[{
            "encrypted_key":"4PQsjDGs8IE3YqgcoGfwPTuVG25MKjojx4HSZqcjfkhr0qhwqkpUUw",
            "header":{
                "kid":"urn:rfc7638:sha-256:Base64Url(SHA256(JWK))",
                "alg":"ML-KEM",
                // ...
            },
        }],
        "iv":"FoJ5uPIR6HDPFCtD",
        "ciphertext":"tIupQ-9MeYLdkAc1Us0Mdlp1kZ5Dbavq0No-eJ91cF0R0hE",
        "tag":"TMRcEPc74knOIbXhLDJA_w"
    },
    "meta": {
        "created": "2019-06-19",
        "contentType": "...",
        "chunks": 0
    },
}