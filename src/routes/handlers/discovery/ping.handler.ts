// src/routes/handlers/discovery/ping.handler.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Request, Response } from 'express';
import { createOperationOutcome } from '../../../utils/outcome';
import { compactJWT } from '../../../utils/jwt';
import { convertPrimaryDocToFhirBundle } from '../../../utils/jsonapi';
import { IPayloadResponse } from '../../../models/response';
import { composeHostDidWebId, getTenantDidWebId } from '../../../utils/did';
import { IssueLevel, IssueType } from '../../../models/fhir/codes';

/**
 * Handles requests to the ping endpoint (e.g., `/.well-known/ping`).
 * This endpoint serves two purposes:
 * 1. A basic health check to confirm the service is running.
 * 2. A demonstration of the API's content negotiation capabilities.
 *
 * The structure of the response varies based on the client's `Accept` header,
 * showcasing the different data formats the API supports.
 */
export const pingHandler = async (req: Request, res: Response) => {
    const tenantId = res.locals.tenantId as string;

    // 1. Create the canonical response body (the Bundle). This is the base data structure.
    const responseBundle = {
        type: 'batch-response',
        meta: {
            timestamp: new Date().toISOString(),
            tenantId: tenantId,
        },
        data: [ createOperationOutcome(IssueLevel.Information, IssueType.Throttled, 'Ping successful') ],
    };

    const acceptedType = req.accepts(['application/json', 'application/fhir+json', 'application/x-www-form-urlencoded']);

    switch (acceptedType) {
        case 'application/fhir+json':
            // For FHIR clients, we demonstrate the ability to transform our canonical
            // JSON:API-style bundle into a standard FHIR Bundle by changing `data` to `entry`.
            const responseBundleFhir = convertPrimaryDocToFhirBundle(responseBundle, 'batch-response');
            res.json(responseBundleFhir);
            break;

        case 'application/x-www-form-urlencoded':
            // For FAPI/JARM-compliant clients, we demonstrate the full secure response format.
            // The canonical bundle is wrapped in the JARM `IPayloadResponse` envelope
            // (with iss, aud, etc.), and then compacted into an unsigned JWS.
            const issuerDid = tenantId === 'host' ? composeHostDidWebId() : getTenantDidWebId(tenantId);
            const responsePayload: IPayloadResponse = {
                thid: `ping-${Date.now()}`,
                iss: issuerDid,
                aud: 'anonymous',
                exp: Math.floor(Date.now() / 1000) + 300, // Expires in 5 minutes
                body: responseBundle,
            };
            const jws = await compactJWT({ alg: 'none' }, responsePayload);
            res.type('application/x-www-form-urlencoded').send(`response=${jws}`);
            break;

        case 'application/json':
        default:
            // For standard JSON API clients, we return the canonical bundle directly,
            // without the JARM envelope.
            res.json(responseBundle);
            break;
    }
};
