// src/managers/IndividualManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4} from 'uuid';
import { getBundleResponseTypeForAction } from '../utils/bundle';
import { BundleJsonApi, BundleEntry, BundleEntryRequest, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueLevel, IssueType } from 'gdc-sdk-client-ts/src/models/issue';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import { ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { initializeCustomerServices } from '../utils/services'; 
import { createOperationOutcome } from '../utils/outcome';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ParameterData } from 'gdc-common-utils-ts/models/params'; // extends ParamAttribute with `type` and others
import { CredentialManager } from './CredentialManager';
import { TenantsCacheManager } from './TenantsCacheManager';
import { parseTenantUrn } from '../utils/urn';
import { getTenantVaultId } from '../utils/tenant';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { determineResourceId } from '../utils/resource';
import { uuidToBytes } from '../utils/uuid';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { getJurisdictionGroup } from '../utils/jurisdiction';
import { normalizePhoneNumber } from '../utils/phone-number';
import { parseIdentifierType } from '../utils/identifier-parser';
import { generateUrnHash } from '../utils/urn-hash';
import { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { EntityLifecycleStatus, EntityType } from '../gdc-backend-utils-node/models/enums';
import { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { generateLicenseOffer } from '../utils/offer';


const INDIVIDUAL_SECTION = 'individual';
const DEVICE_LICENSE_SECTION = 'device-licenses';

export class IndividualManager {
  private vaultRepository: IVaultRepository;
  private kmsService: IKmsService;
  private tenantsCacheManager: TenantsCacheManager;
  private credentialManager: CredentialManager;
  private blockchainAdapter: IBlockchainAdapter;
  private network: string;

  constructor(
    vaultRepository: IVaultRepository,
    kmsService: IKmsService,
    tenantsCacheManager: TenantsCacheManager,
    credentialManager: CredentialManager,
    blockchainAdapter: IBlockchainAdapter,
    network: string
  ) {
    this.vaultRepository = vaultRepository;
    this.kmsService = kmsService;
    this.tenantsCacheManager = tenantsCacheManager;
    this.credentialManager = credentialManager;
    this.blockchainAdapter = blockchainAdapter;
    this.network = network;
  }

  public async process(job: JobRequest, environment?: string): Promise<IDecodedDidcommPayload> {
    // console.log('[IndividualManager] Processing job:', JSON.stringify(job, null, 2));
    const responseEntries: (BundleEntry | ErrorEntry)[] = [];
    const entries = job.content?.body?.data ?? [];
    
    // The Manager is responsible for constructing the vaultId from the job's context
    const tenantVaultId = getTenantVaultId(job.sector!, job.tenantId!);

    const issuerUrn = await this.tenantsCacheManager.getTenantIdentifierUrn(tenantVaultId);
    if (!issuerUrn) {
      throw new ManagerError(`Tenant with vaultId '${tenantVaultId}' could not be resolved.`, IssueType.NotFound);
    }
    
    /** A `_batch` implies claim aggregation to create a single individual. */
    switch(job.action) {
      case '_batch':
      case '_create':
        try {
          const resultEntry = await this.processCreationBatch(entries, tenantVaultId, issuerUrn, environment);
          responseEntries.push(resultEntry);
        } catch (error: any) {
          const errorEntry = this.handleError(error, 'Customer-creation-batch-v1.0', job.content?.body);
          responseEntries.push(errorEntry);
        }
        break;
      
      case '_discovery':
        const discoveryResults = await this.processDiscoveryBatch(entries, job.sector!, job.resourceType!);
        responseEntries.push(...discoveryResults);
        break;

      default:
        throw new ManagerError(`Unsupported action '${job.action}' for IndividualManager.`, IssueType.NotSupported);
    }

    const responseBundle: BundleJsonApi = {
      resourceType: 'Bundle',
      type: getBundleResponseTypeForAction(job.action),
      total: responseEntries.length,
      data: responseEntries,
    };

    const result: IDecodedDidcommPayload = {
      jti: uuidv4(),
      thid: job.content?.thid as string,
      iss: issuerUrn,
      aud: job.content?.aud as string,
      exp: Math.floor(Date.now() / 1000) + 300,
      type: 'api+json',
      body: responseBundle,
    };
    return result;
  }

  private async processCreationBatch(
    entries: BundleEntryRequest[],
    tenantVaultId: string,
    tenantUrn: string,
    environment?: string,
  ): Promise<BundleEntry> {
    
    const parsedTenantUrn = parseTenantUrn(tenantUrn);
    const sector = parsedTenantUrn?.sector as Sector;
    const jurisdiction = parsedTenantUrn?.jurisdiction || 'us';

    const aggregatedClaims = this._aggregateBatchClaims(entries);
    const { person, service } = this._extractResources(aggregatedClaims, environment);
    const internalId = person.id;
    const publicUuidUrn = person.meta.claims[ClaimsPersonSchemaorg.identifier] as string;

    const licenseOffer = await this.tryConsumeIndividualSeatOrOffer({
      tenantVaultId,
      individualId: internalId,
      sector: sector || (aggregatedClaims as any)[ClaimsServiceSchemaorg.category] || 'health-care',
      jurisdiction,
    });
    if (licenseOffer) return licenseOffer;

    const parametersToIndex = this._buildIndexParameters(aggregatedClaims);
    const indexedAttributes = await this.kmsService.protectAttributesNameAndValue(parametersToIndex, tenantVaultId);

    const multibaseId = encodeMultibase58btc(uuidToBytes(internalId));
    const customerUrn = `${tenantUrn}:individual:multibase:${multibaseId}`;
    
    const individualConfig: EntityConfig = {
      id: internalId,
      type: EntityType.Person,
      status: EntityLifecycleStatus.Active,
      claims: aggregatedClaims,
      didDocument: {
        '@context': 'https://www.w3.org/ns/did/v1',
        id: customerUrn,
        service: [],
      },
      didConfig: { service: [] },
      meta: {
        lastUpdated: new Date().toISOString(),
      },
    };

    const tenantClaims = await this.tenantsCacheManager.getEntityClaims(tenantVaultId);
    if (!tenantClaims) {
      throw new ManagerError(`Could not retrieve claims for tenant vault ${tenantVaultId}`, IssueType.NotFound);
    }
    
    individualConfig.didDocument!.service = initializeCustomerServices(individualConfig, sector, tenantClaims);
    individualConfig.didConfig!.service = individualConfig.didDocument!.service;

    const docToStore: ConfidentialStorageDoc = {
      id: internalId,
      status: individualConfig.status,
      sequence: 0,
      indexed: { attributes: indexedAttributes },
      content: individualConfig,
    };
    const protectedDoc = await this.kmsService.protectConfidentialData(docToStore, tenantVaultId);
    await this.vaultRepository.put(tenantVaultId, [protectedDoc], INDIVIDUAL_SECTION);
    
    person.meta.claims[ClaimsPersonSchemaorg.identifier] = publicUuidUrn;

    return {
      type: 'Customer',
      resource: {
        ...person,
        resourceType: 'Person',
        contained: [
          { ...service, resourceType: 'Service' }
        ],
      },
      response: { status: '201' },
    };
  }

  private async processDiscoveryBatch(
    entries: BundleEntryRequest[],
    sector: string,
    resourceType: string,
  ): Promise<(BundleEntry | ErrorEntry)[]> {
    const tasksByTarget = new Map<string, { hash: string; originalEntry: BundleEntryRequest }[]>();
    const finalResults: (BundleEntry | ErrorEntry)[] = [];
    const entryMap = new Map(entries.map(e => [e.meta?.claims, e]));

    // 1. Prepare all discovery tasks and group them by target (channel + chaincode)
    for (const entry of entries) {
      const claims = entry.meta?.claims;
      const prepResult = this.prepareUrnAndJurisdiction(claims as any);

      if (!prepResult.urn) {
        finalResults.push({
          type: entry.type,
          meta: entry.meta,
          response: {
            status: '400',
            outcome: createOperationOutcome(IssueLevel.Error, IssueType.Invalid, 'Unsupported discovery claim type'),
          },
        });
        continue;
      }

      const hash = generateUrnHash(prepResult.urn);
      const channel = `${sector}-${prepResult.jurisdictionGroup}`;
      const chaincode = `discovery-${resourceType.toLowerCase()}`;
      const targetKey = `${channel}:${chaincode}`;

      if (!tasksByTarget.has(targetKey)) {
        tasksByTarget.set(targetKey, []);
      }
      tasksByTarget.get(targetKey)!.push({ hash, originalEntry: entry });
    }

    // 2. Execute batch queries for each target group
    const discoveryPromises = Array.from(tasksByTarget.entries()).map(async ([targetKey, tasks]) => {
      const [channel, chaincode] = targetKey.split(':');
      const hashesToQuery = tasks.map(t => t.hash);

      const foundDids = await this.blockchainAdapter.discoverDidsByHashes(hashesToQuery, channel, chaincode);

      foundDids.forEach((did, index) => {
        const originalTask = tasks[index];
        finalResults.push({
          type: originalTask.originalEntry.type,
          meta: originalTask.originalEntry.meta,
          response: did
            ? { status: '200', location: did }
            : { status: '404', outcome: createOperationOutcome(IssueLevel.Information, IssueType.NotFound, 'Identifier not found on the network') },
        });
      });
    });

    await Promise.all(discoveryPromises);
    
    // Re-sort results to match the original input order, because Promise.all does not guarantee order
    const sortedResults = [...finalResults].sort((a, b) => {
        const claimsA = JSON.stringify(a.meta?.claims);
        const claimsB = JSON.stringify(b.meta?.claims);
        return Array.from(entryMap.keys()).findIndex(k => JSON.stringify(k) === claimsA) - Array.from(entryMap.keys()).findIndex(k => JSON.stringify(k) === claimsB);
    });

    return sortedResults;
  }

  private prepareUrnAndJurisdiction(claims: ClaimsRecord): { urn?: string; jurisdictionGroup: 'eu' | 'global' } {
    let urn: string | undefined;
    let jurisdictionGroup: 'eu' | 'global' = 'global';

    const identifierType = claims[ClaimsPersonSchemaorg.identifierType] as string;
    const identifierValue = claims[ClaimsPersonSchemaorg.identifierValue] as string;
    const telephone = claims[ClaimsPersonSchemaorg.telephone] as string;

    if (identifierType && identifierValue) {
      const parsedId = parseIdentifierType(identifierType);
      if (parsedId.countryCode) {
        jurisdictionGroup = getJurisdictionGroup(parsedId.countryCode);
      }
      urn = `urn:${this.network}:${jurisdictionGroup}:identifier:${identifierType}:${identifierValue}`;
    } else if (telephone) {
      const normalizedPhone = normalizePhoneNumber(telephone);
      jurisdictionGroup = 'global';
      urn = `urn:${this.network}:${jurisdictionGroup}:mobile:E164:${normalizedPhone}`;
    }

    return { urn, jurisdictionGroup };
  }



  private _aggregateBatchClaims(entries: BundleEntryRequest[]): ClaimsRecord {
    const aggregatedClaims: ClaimsRecord = {};
    let anchorIdentifier: string | undefined;

    for (const entry of entries) {
      const claims = entry.meta?.claims;
      if (!claims) continue;
      const currentIdentifier = claims[ClaimsPersonSchemaorg.identifier] as string | undefined;
      if (currentIdentifier) {
        if (!anchorIdentifier) {
          anchorIdentifier = currentIdentifier;
        } else if (anchorIdentifier !== currentIdentifier) {
          throw new ManagerError(`Identifier inconsistency in batch: expected '${anchorIdentifier}', but found '${currentIdentifier}'.`, IssueType.Value);
        }
      }
      Object.assign(aggregatedClaims, claims);
    }
    if (!anchorIdentifier) {
      aggregatedClaims[ClaimsPersonSchemaorg.identifier] = `urn:uuid:${uuidv4()}`;
    }
    return aggregatedClaims;
  }

  private _buildIndexParameters(claims: ClaimsRecord): ParameterData[] {
    const parameters: ParameterData[] = [];
    for (const [key, value] of Object.entries(claims)) {
      if (key !== ClaimsPersonSchemaorg.birthDate) {
        if (typeof value === 'object' && value !== null && 'additionalType' in value && 'value' in value) {
          const val = value as any;
          parameters.push({ name: val.additionalType, value: val.value, unique: true, type: 'token' });
        } else if (key.startsWith('org.schema.')) {
          parameters.push({ name: key, value: value as string, type: 'string' });
        }
      }
    }
    return parameters;
  }

  /**
   * Extracts and builds Person and Service resources from a flat claims object.
   * This is a direct adaptation of the pattern used in HostingManager.
   */
  private _extractResources(claims: ClaimsRecord, environment?: string) {
    const resources: Record<string, any> = {};

    // Define the resource types to be extracted for a Customer creation
    const resourceTypes = ['Person', 'Service'];

    for (const type of resourceTypes) {
      const resourceClaims: Record<string, any> = {};
      let claimFound = false;

      for (const key in claims) {
        if (key.startsWith(`org.schema.${type}.`)) {
          resourceClaims[key] = claims[key];
          claimFound = true;
        }
      }

      if (claimFound) {
        const identifierClaim = resourceClaims[`org.schema.${type}.identifier`];
        const resourceId = determineResourceId(identifierClaim, environment);
        
        // Ensure the identifier claim is always a canonical URN.
        resourceClaims[`org.schema.${type}.identifier`] = `urn:uuid:${resourceId}`;
        
        resources[type.toLowerCase()] = {
          id: resourceId,
          type: type,
          meta: { claims: resourceClaims },
        };
      }
    }
    if (!resources.person || !resources.service) {
      throw new ManagerError(
        'Incomplete claims: Person and Service resources are required for individual creation.',
        IssueType.Required,
      );
    }
    return resources as { person: IncludedResource; service: IncludedResource };
  }

  private async tryConsumeIndividualSeatOrOffer(params: {
    tenantVaultId: string;
    individualId: string;
    sector: string;
    jurisdiction: string;
  }): Promise<BundleEntry | undefined> {
    const licenseDocs =
      (await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
        params.tenantVaultId,
        DEVICE_LICENSE_SECTION,
      )) || [];

    const individualLicenseDocs = licenseDocs.filter((doc) => {
      const cls = (doc.content as any)?.userClass;
      // Backward compatibility: old stored licenses used `customer`.
      return cls === 'individual' || cls === 'customer';
    });
    if (individualLicenseDocs.length === 0) {
      // No individual licenses in the vault => licensing not configured; do not gate.
      return undefined;
    }

    const availableDoc = individualLicenseDocs.find((doc) => (doc.content as DeviceLicense).status === 'available');
    if (!availableDoc) {
      const hostDid = (await this.tenantsCacheManager.getTenantDid('host')) || 'did:web:host';
      const allowedPaymentMethods = (process.env.ALLOWED_PAYMENT_METHODS || 'Stripe').split(',').map(s => s.trim()).filter(Boolean);
      const offerClaims = generateLicenseOffer(
        1,
        hostDid,
        params.jurisdiction,
        params.sector,
        allowedPaymentMethods,
        'individual',
      );
      return {
        type: 'Individual-license-offer-v1.0',
        meta: { claims: offerClaims },
        response: { status: '200' },
      };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const updatedLicense: DeviceLicense = {
      ...(availableDoc.content as DeviceLicense),
      status: 'issued',
      subjectId: params.individualId,
      issuedAt: nowSec,
    };
    await this.vaultRepository.put(
      params.tenantVaultId,
      [{ ...availableDoc, content: updatedLicense }],
      DEVICE_LICENSE_SECTION,
    );
    return undefined;
  }

  private handleError(error: any, entryType: string = 'unknown', meta?: any): ErrorEntry {
    if (error instanceof ManagerError) {
      return {
        type: entryType,
        meta: meta,
        response: {
          status: error.status,
          outcome: createOperationOutcome(IssueLevel.Error, error.code, error.message),
        },
      };
    } else {
      console.error('Unexpected error during individual processing:', error);
      return {
        type: entryType,
        meta: meta,
        response: {
          status: '500',
          outcome: createOperationOutcome(
            IssueLevel.Error,
            IssueType.Exception,
            'An unexpected internal server error occurred.',
          ),
        },
      };
    }
  }
}
