// Flow contract: resolve an old controller seat only from the protected current tenant designation and exact active employee; preserve actor keys and licence authority across an additional installation.
import { describe, expect, it, jest } from '@jest/globals';
import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { HealthcareActorRoles, HealthcareActorRoleCodes } from 'gdc-common-utils-ts/constants/healthcare';
import { HL7_CODING_SYSTEM_V3_ROLE_CODE } from 'gdc-common-utils-ts/constants/hl7-roles';
import { EXAMPLE_CONTROLLER_DID, EXAMPLE_EMAIL_PROFESSIONAL, EXAMPLE_LEGAL_ORGANIZATION_TAX_ID, EXAMPLE_TENANT_ROUTE_CONTEXT, EXAMPLE_KYC_CONTROLLER_USER_UUID, EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL } from 'gdc-common-utils-ts/examples/shared';
import { issueActivationCodeFromPool } from '../../../utils/license-issuance';
import { resolveHostPhysicalCollectionName } from '../../../config/storage-layout';
import { getEnvSectionId } from '../../../utils/section-env';
import { DeviceRegistrationManager } from '../../../managers/DeviceRegistrationManager';
import { DCR_REGISTRATION_JOB } from '../../data/example-jobs';
import cloneDeep from 'lodash.clonedeep';
import { normalizeSameAsHash } from 'gdc-common-utils-ts/utils/same-as';
import { createEmployeeUrn, createEmployeeUrnFromStableActorIdentifier, getTenantIdentifierUrnPrefix } from '../../../utils/urn';
import { generateTenantCollectionNameFromClaims, getTenantVaultId } from '../../../utils/tenant';
import { URN_NAMESPACE, URN_NETWORK, URN_VERSION, URN_ORGANIZATION_ID_TYPE } from '../../data/urn.data';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';

function fixture() {
  const route = EXAMPLE_TENANT_ROUTE_CONTEXT;
  const role = HealthcareActorRoles.GeneralistMedicalPractitioner;
  const claims: Record<string, unknown> = {
    [ClaimsOrganizationSchemaorg.alternateName]: route.tenantId,
    [ClaimsOrganizationSchemaorg.addressCountry]: route.jurisdiction,
    [ClaimsOrganizationSchemaorg.identifierType]: URN_ORGANIZATION_ID_TYPE,
    [ClaimsOrganizationSchemaorg.identifierValue]: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,
    [ClaimsServiceSchemaorg.category]: route.sector,
  };
  const tenantVaultId = getTenantVaultId(route.sector, route.tenantId);
  const employeeUrn = createEmployeeUrn({namespace: URN_NAMESPACE, network: URN_NETWORK, jurisdiction: route.jurisdiction, version: URN_VERSION, sector: route.sector, idType: URN_ORGANIZATION_ID_TYPE, idValue: EXAMPLE_LEGAL_ORGANIZATION_TAX_ID, email: EXAMPLE_EMAIL_PROFESSIONAL, role});
  claims[ClaimsOrganizationSchemaorg.identifier] = getTenantIdentifierUrnPrefix(employeeUrn);
  const tenant = { status: 'active', claims, didDocument: {controller: [EXAMPLE_CONTROLLER_DID]} };
  const employee = {id: EXAMPLE_CONTROLLER_DID, status: 'active', claims: {[ClaimsPersonSchemaorg.email]: EXAMPLE_EMAIL_PROFESSIONAL, [ClaimsPersonSchemaorg.hasOccupation]: role, [ClaimsPersonSchemaorg.additionalType]: HealthcareActorRoles.Controller} as Record<string, unknown>, didDocument: {id: EXAMPLE_CONTROLLER_DID, alsoKnownAs: [employeeUrn], verificationMethod: []}};
  const license: any = {userClass: 'employee', status: 'active', activatedBy: normalizeSameAsHash(EXAMPLE_EMAIL_PROFESSIONAL), issuedToEmail: EXAMPLE_EMAIL_PROFESSIONAL, issuedToRole: role, exp: Math.floor(Date.now()/1000)+600};
  const repository = {get: jest.fn(async (collection: string, id: string) => collection === resolveHostPhysicalCollectionName() && id === tenantVaultId ? {id, jwe: {ciphertext: 'tenant'}} : collection === generateTenantCollectionNameFromClaims(claims) && id === employee.id ? {id, jwe: {ciphertext: 'employee'}} : undefined)};
  const kms = {unprotectConfidentialData: jest.fn(async (doc: any) => doc.jwe.ciphertext === 'tenant' ? tenant : employee)};
  const manager = new DeviceRegistrationManager('http://localhost:3001', repository as any, kms as any, {getCollectionName: async () => generateTenantCollectionNameFromClaims(claims)});
  const job = cloneDeep(DCR_REGISTRATION_JOB);
  Object.assign(job, route);
  const resolveSubject = () => (manager as any).prepareEmployeeDeviceIdentityContext({job, vaultId: tenantVaultId, licenseDoc: {id:'legacy-seat',content:license}, registrationRequest: job.content!.body, clientId:'new-device'});
  return {tenant,employee,license, repository,kms, resolveSubject};
}

describe('protected legacy controller licence subject', () => {
  it('resolves the real controller id without replacing its original occupational licence role', async () => {
    const f=fixture();
    expect(await f.resolveSubject()).toMatchObject({subjectId:f.employee.id, licensedRole:f.license.issuedToRole});
    expect(f.license.issuedToRole).not.toBe(HealthcareActorRoles.Controller);
    expect(f.kms.unprotectConfidentialData).toHaveBeenCalledWith(expect.anything(), 'host');
  });
  it.each(['tenant-inactive','employee-inactive','wrong-role','wrong-contact','foreign-actor','not-controller','wrong-sector','wrong-tenant','expired','revoked'] as const)('rejects %s without writing', async (change) => {
    const f=fixture();
    if(change==='tenant-inactive') f.tenant.status='inactive';
    if(change==='employee-inactive') f.employee.status='inactive';
    if(change==='wrong-role') f.license.issuedToRole=HealthcareActorRoles.Veterinarian;
    if(change==='wrong-contact') f.employee.claims[ClaimsPersonSchemaorg.email]='';
    if(change==='foreign-actor') f.license.activatedBy=normalizeSameAsHash(EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL);
    if(change==='not-controller') f.tenant.didDocument.controller=[];
    if(change==='wrong-sector') f.tenant.claims[ClaimsServiceSchemaorg.category]='';
    if(change==='wrong-tenant') f.tenant.claims[ClaimsOrganizationSchemaorg.alternateName]='';
    if(change==='expired') f.license.exp=1;
    if(change==='revoked') f.license.status='revoked';
    await expect(f.resolveSubject()).rejects.toThrow();
  });
  it.each(['inactive', 'revoked', 'foreign-record'] as const)('rejects a %s tenant envelope even when its protected content is active', async (status) => {
    const f = fixture();
    const originalGet = f.repository.get.getMockImplementation()!;
    f.repository.get.mockImplementation(async (collection: string, id: string) => {
      const document = await originalGet(collection, id);
      return collection === resolveHostPhysicalCollectionName() && document
        ? {...document, ...(status === 'foreign-record' ? {id: EXAMPLE_KYC_CONTROLLER_USER_UUID} : {status})}
        : document;
    });
    await expect(f.resolveSubject()).rejects.toMatchObject({code: IssueType.Forbidden});
  });
  it('does not guess from a contact when the protected tenant is absent', async () => {
    const f=fixture(); f.repository.get.mockResolvedValue(undefined);
    await expect(f.resolveSubject()).rejects.toThrow();
  });
  it('reports an unverified controller binding as an authorization denial', async () => {
    const f=fixture(); f.tenant.didDocument.controller=[];
    await expect(f.resolveSubject()).rejects.toMatchObject({ code: IssueType.Forbidden, status: String(HttpStatusCodes.Forbidden) });
  });
  it('rechecks an inactive controller even when its licence already has a subject link', async () => {
    const f=fixture(); f.license.subjectId=f.employee.id; f.employee.status='inactive';
    await expect(f.resolveSubject()).rejects.toMatchObject({ code: IssueType.Forbidden, status: String(HttpStatusCodes.Forbidden) });
  });
  it('does not let an existing subject link override a removed current controller designation', async () => {
    const f=fixture(); f.license.subjectId=f.employee.id; f.tenant.didDocument.controller=[];
    await expect(f.resolveSubject()).rejects.toMatchObject({ code: IssueType.Forbidden, status: String(HttpStatusCodes.Forbidden) });
  });
  it('resolves a designated technical controller from its protected sameAs and controller licence without rewriting its occupation or keys', async () => {
    const f=fixture();
    const occupation=f.employee.claims[ClaimsPersonSchemaorg.hasOccupation];
    f.license.issuedToRole=HealthcareActorRoles.Controller;
    f.employee.claims={
      [ClaimsPersonSchemaorg.identifier]:f.employee.id,
      [ClaimsPersonSchemaorg.sameAs]:f.license.activatedBy,
      [ClaimsPersonSchemaorg.additionalType]:HealthcareActorRoles.Controller,
      [ClaimsPersonSchemaorg.hasOccupationalCategory]:[occupation],
    };
    f.employee.didDocument.alsoKnownAs=[];
    const before=structuredClone(f.employee);
    const employeeUrn=createEmployeeUrnFromStableActorIdentifier({
      organizationUrn:String(f.tenant.claims[ClaimsOrganizationSchemaorg.identifier]),
      stableActorIdentifier:f.license.activatedBy,role:f.license.issuedToRole,
    });
    expect(await f.resolveSubject()).toMatchObject({subjectId:f.employee.id,licensedRole:HealthcareActorRoles.Controller,employeeUrn});
    expect(f.employee).toEqual(before);
  });
  it('repairs the missing subject link idempotently without rotating the code, seat or existing devices', async () => {
    const f=fixture();
    const original = {id:'legacy-seat',status:'active',sequence:7,content:{...f.license,activationCode:'retained-test-credential',deviceBindings:[{clientId:'first-installation',clientInstanceId:'first-installation',status:'active'}]}};
    let stored=structuredClone(original);
    const put=jest.fn(async (_vault:any, docs:any[]) => {stored=structuredClone(docs[0]);return true;});
    const repo={...f.repository,getContainersInSection:async()=>[stored],put};
    const args={vaultRepository:repo as any,kmsService:f.kms as any,tenantVaultId:getTenantVaultId(EXAMPLE_TENANT_ROUTE_CONTEXT.sector,EXAMPLE_TENANT_ROUTE_CONTEXT.tenantId),userClass:'employee' as const,type:'mobile' as const,email:f.license.issuedToEmail,role:f.license.issuedToRole,subjectId:f.employee.id};
    const first=await issueActivationCodeFromPool(args);
    expect(stored.content).toEqual({...original.content,subjectId:f.employee.id});
    expect(stored.sequence).toBe(8);
    expect(first).toMatchObject({licenseId:original.id,activationCode:original.content.activationCode});
    expect(await issueActivationCodeFromPool(args)).toEqual(first);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(args.tenantVaultId,expect.anything(),getEnvSectionId('device-licenses'));
  });
  it('keeps an encrypted licence encrypted while repairing its subject link', async () => {
    const f = fixture();
    const license = {...f.license, activationCode: 'retained-test-credential'};
    const original = {id: 'protected-legacy-seat', status: 'active', sequence: 2, jwe: {ciphertext: 'seat'}};
    const originalUnprotect = f.kms.unprotectConfidentialData.getMockImplementation()!;
    f.kms.unprotectConfidentialData.mockImplementation(async (document: any) =>
      document.jwe.ciphertext === 'seat' ? license : originalUnprotect(document));
    const protect = jest.fn(async (document: any) => ({id: document.id, status: document.status, sequence: document.sequence, jwe: {ciphertext: 'reprotected-seat'}}));
    const put = jest.fn(async () => true);
    const repository = {...f.repository, getContainersInSection: async () => [original], put};
    const kms = {...f.kms, protectConfidentialData: protect};
    const vaultId = getTenantVaultId(EXAMPLE_TENANT_ROUTE_CONTEXT.sector, EXAMPLE_TENANT_ROUTE_CONTEXT.tenantId);
    const result = await issueActivationCodeFromPool({vaultRepository: repository as any, kmsService: kms as any, tenantVaultId: vaultId, userClass: 'employee', type: 'mobile', email: license.issuedToEmail, role: license.issuedToRole, subjectId: f.employee.id});
    expect(result.activationCode).toBe(license.activationCode);
    expect(protect).toHaveBeenCalledWith(expect.objectContaining({content: {...license, subjectId: f.employee.id}}), vaultId);
    expect(put).toHaveBeenCalledWith(vaultId, [{...original, sequence: 3, jwe: {ciphertext: 'reprotected-seat'}}], getEnvSectionId('device-licenses'));
    expect(license.subjectId).toBeUndefined();
  });
  it('refuses to redirect a licence already linked to another employee', async () => {
    const f=fixture();
    const put=jest.fn();
    const repo={...f.repository,getContainersInSection:async()=>[{id:'legacy-seat',content:{...f.license,activationCode:'retained-test-credential',subjectId:'different-existing-employee'}}],put};
    await expect(issueActivationCodeFromPool({vaultRepository:repo as any,kmsService:f.kms as any,tenantVaultId:getTenantVaultId(EXAMPLE_TENANT_ROUTE_CONTEXT.sector,EXAMPLE_TENANT_ROUTE_CONTEXT.tenantId),userClass:'employee',type:'mobile',email:f.license.issuedToEmail,role:f.license.issuedToRole,subjectId:f.employee.id})).rejects.toMatchObject({ code: IssueType.Conflict, status: String(HttpStatusCodes.Conflict) });
    expect(put).not.toHaveBeenCalled();
  });
  it('leaves personal member seat reconciliation to its existing lifecycle', async () => {
    const f=fixture();
    const stored={id:'personal-seat',content:{...f.license,userClass:'individual',issuedToRole:`${HL7_CODING_SYSTEM_V3_ROLE_CODE}|${HealthcareActorRoleCodes.Controller}`,activationCode:'retained-test-credential'}};
    const put=jest.fn();
    const repo={getContainersInSection:async()=>[stored],put};
    const result=await issueActivationCodeFromPool({vaultRepository:repo as any,tenantVaultId:getTenantVaultId(EXAMPLE_TENANT_ROUTE_CONTEXT.sector,EXAMPLE_TENANT_ROUTE_CONTEXT.tenantId),userClass:'individual',type:'mobile',email:f.license.issuedToEmail,role:stored.content.issuedToRole,subjectId:EXAMPLE_KYC_CONTROLLER_USER_UUID});
    expect(result.activationCode).toBe(stored.content.activationCode);
    expect(put).not.toHaveBeenCalled();
  });
  it('preserves an older account marker during authorized seat repair and still requires fresh exchange before DCR', async () => {
    const f=fixture();
    f.license.activatedBy='firebase:historical-test-account';
    let stored={id:'legacy-seat',status:'active',sequence:1,content:{...f.license,activationCode:'retained-test-credential'}};
    const put=jest.fn(async (_vault:unknown,rows:any[])=>{stored=structuredClone(rows[0]);return true;});
    const repo={...f.repository,getContainersInSection:async()=>[stored],put};
    const result=await issueActivationCodeFromPool({vaultRepository:repo as any,kmsService:f.kms as any,tenantVaultId:getTenantVaultId(EXAMPLE_TENANT_ROUTE_CONTEXT.sector,EXAMPLE_TENANT_ROUTE_CONTEXT.tenantId),userClass:'employee',type:'mobile',email:f.license.issuedToEmail,role:f.license.issuedToRole,subjectId:f.employee.id});
    expect(result.activationCode).toBe('retained-test-credential');
    expect(stored.content.activatedBy).toBe(f.license.activatedBy);
    expect(stored.content.subjectId).toBe(f.employee.id);
    await expect(f.resolveSubject()).rejects.toMatchObject({code:IssueType.BusinessRule});
    expect(put).toHaveBeenCalledTimes(1);
  });

});
