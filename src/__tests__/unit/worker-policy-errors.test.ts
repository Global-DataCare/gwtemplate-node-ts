// Flow contract: preserve typed policy denials and request correlation, select tenant response authority only from the current registered tenant, and keep unexpected errors host-scoped and generic. This unit boundary inspects the encoder input; image proof verifies the protected wire response.
import { jest } from '@jest/globals';
import { mock } from 'jest-mock-extended';
import { Worker } from '../../worker';
import type { ManagerRegistry, IJobProcessor } from '../../managers/registry';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { EXAMPLE_PROVIDER_ORGANIZATION_DID, EXAMPLE_SUBJECT_DID, EXAMPLE_TENANT_ROUTE_CONTEXT, EXAMPLE_DEVICE_CLIENT_ID } from 'gdc-common-utils-ts/examples/shared';
import { testCreateCustomerJobRequestProfessionalOnboarding } from '../data/customer-onboarding.data';
import { deriveDeterministicEcJwkPair } from '../utils/deterministic-jwt-fixtures';
import { createJobName } from '../../utils/naming';
import { getTenantVaultId } from '../../utils/tenant';
import { composeHostDidWebId } from '../../utils/did-backend';

const API_BASE_URL='https://api.example.com';
describe('typed worker policy responses',()=>{
 afterEach(()=>jest.restoreAllMocks());
 async function fixture(error:Error,host=false,operational=true,resolverThrows=false){
  jest.spyOn(console,'error').mockImplementation(()=>undefined);
  const route=EXAMPLE_TENANT_ROUTE_CONTEXT,tenantId=host?'host':route.tenantId;
  const key=deriveDeterministicEcJwkPair({seed:EXAMPLE_DEVICE_CLIENT_ID,purpose:'worker-response-recipient'}).publicJwk;
  const manager=mock<IJobProcessor>();manager.process.mockRejectedValue(error);
  const tenants={isTenantOperational:jest.fn(async()=>{if(resolverThrows)throw new Error('Tenant lookup unavailable');return operational;}),getDidDocument:jest.fn(async()=>({id:EXAMPLE_PROVIDER_ORGANIZATION_DID}))};
  const kms=mock<IKmsService>();kms.encodeResponse.mockImplementation(async payload=>JSON.stringify(payload));
  const registry=mock<ManagerRegistry>({openIdAuthManager:manager,tenantManager:tenants as any});
  const job={...testCreateCustomerJobRequestProfessionalOnboarding,tenantId,sector:route.sector,jurisdiction:route.jurisdiction,contentType:'application/x-www-form-urlencoded',action:'token',content:{...testCreateCustomerJobRequestProfessionalOnboarding.content,iss:EXAMPLE_SUBJECT_DID,aud:EXAMPLE_SUBJECT_DID,jti:EXAMPLE_DEVICE_CLIENT_ID,thid:EXAMPLE_DEVICE_CLIENT_ID,meta:{jwe:{header:{jwk:key}}}}} as any;
  const name=createJobName(getTenantVaultId(route.sector,tenantId),'smart','token');
  const result=JSON.parse(await new Worker(registry,API_BASE_URL,kms).process(name,job));
  return{result,kms,key,job,tenants,vaultId:getTenantVaultId(route.sector,tenantId)};
 }
 it('preserves a tenant policy403 with the current tenant issuer and sender vault',async()=>{
  const f=await fixture(new ManagerError('Current consent does not authorize this request.',IssueType.Forbidden));
  expect(f.result).toMatchObject({iss:EXAMPLE_PROVIDER_ORGANIZATION_DID,aud:EXAMPLE_SUBJECT_DID,jti:f.job.content.jti,thid:f.job.content.thid});
  expect(f.result.body.data[0].response).toMatchObject({status:'403',outcome:{issue:[{code:IssueType.Forbidden,diagnostics:'Current consent does not authorize this request.'}]}});
  expect(f.kms.encodeResponse).toHaveBeenCalledWith(expect.any(Object),[f.key],f.vaultId);
 });
 it('keeps host policy403 under the host response authority',async()=>{
  const f=await fixture(new ManagerError('Host policy rejected the request.',IssueType.Forbidden),true);
  expect(f.result.body.data[0].response.status).toBe('403');expect(f.result.iss).toBe(composeHostDidWebId(API_BASE_URL));expect(f.kms.encodeResponse).toHaveBeenCalledWith(expect.any(Object),[f.key],'host');expect(f.tenants.isTenantOperational).not.toHaveBeenCalled();
 });
 it('keeps an unexpected spoofed403 host-scoped500 without internal diagnostics',async()=>{
  const f=await fixture(Object.assign(new Error('Internal implementation diagnostic'),{status:'403',code:IssueType.Forbidden}));
  expect(f.result.iss).toBe(composeHostDidWebId(API_BASE_URL));expect(f.result.body.data[0].response).toMatchObject({status:'500',outcome:{issue:[{code:IssueType.Exception,diagnostics:'Gateway operation failed.'}]}});expect(f.kms.encodeResponse).toHaveBeenCalledWith(expect.any(Object),[f.key],'host');
 });
 it.each([['inactive tenant',false,false],['unavailable tenant',true,true]])('does not derive response authority from request fields for %s',async(_label,operational,resolverThrows)=>{
  const f=await fixture(new ManagerError('Current consent does not authorize this request.',IssueType.Forbidden),false,operational as boolean,resolverThrows as boolean);
  expect(f.result.iss).toBe(composeHostDidWebId(API_BASE_URL));expect(f.result.body.data[0].response.status).toBe('403');expect(f.kms.encodeResponse).toHaveBeenCalledWith(expect.any(Object),[f.key],'host');
 });
});
