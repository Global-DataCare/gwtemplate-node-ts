// Flow contract: verify the signed registered professional presentation using the canonical subject-key binding schema, active key and professional assignment; deny each inconsistent ledger source. Current protected licence and employment checks are exercised independently by registered-professional-state.test.ts.
import { buildLocalClearingHouseVerifier } from '../../../bootstrap/build-clearing-house-verifier';
import { createRequire } from 'node:module';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { getEnvSectionId } from '../../../utils/section-env';
import { ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ManageAssetCryptographicKey } from '../../../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../../../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import { ManageAssetProfessionalAssignment } from '../../../blockchain/fabric/v3/manageAssetProfessionalAssignment';
import { ManageAsset } from '../../../blockchain/fabric/v3/manageAsset';
import { CredentialLedgerAdapterMem } from '../../../adapters/CredentialLedgerAdapterMem';
import { buildProfessionalIdentityVpPayload } from 'gdc-common-utils-ts/utils/professional-smart';
import { EXAMPLE_DEVICE_CLIENT_ID, EXAMPLE_PROFESSIONAL_DID, EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN, EXAMPLE_PROVIDER_ORGANIZATION_DID } from 'gdc-common-utils-ts/examples/shared';
import { buildDeterministicSignedJwt, deriveDeterministicEcJwkPair } from '../../utils/deterministic-jwt-fixtures';
import { tryGetJwkThumbprint } from '../../../utils/ledger-organization-registration-helpers';
import { createEmployeeUrn } from '../../../utils/urn';
import { buildProfessionalAssignmentLedgerPayload } from '../../../utils/professional-assignment-ledger';
import { URN_NAMESPACE, URN_NETWORK, URN_VERSION, URN_ORGANIZATION_ID_TYPE } from '../../data/urn.data';
import { EXAMPLE_TENANT_ROUTE_CONTEXT, EXAMPLE_LEGAL_ORGANIZATION_TAX_ID, EXAMPLE_CONTROLLER_EMAIL } from 'gdc-common-utils-ts/examples/shared';
const ownerRequire=createRequire(import.meta.url);
const { buildStoredSubjectKeyBindingAsset } = ownerRequire('../../../../chaincode/subjectkeybinding-sc-javascript/lib/subject-key-binding-asset');

describe('professional Fabric binding schema', () => {
 const savedEnv={...process.env};
 afterEach(()=>{jest.restoreAllMocks();jest.resetAllMocks();process.env={...savedEnv};});
 async function fixture(){
  process.env.LEDGER_MSP_ID='TestMSP';process.env.HOST_JURISDICTION=EXAMPLE_TENANT_ROUTE_CONTEXT.jurisdiction;
  const role=EXAMPLE_HEALTHCARE_ACTOR_ROLE_PHYSICIAN;
  const employeeUrn=createEmployeeUrn({namespace:URN_NAMESPACE,network:URN_NETWORK,jurisdiction:EXAMPLE_TENANT_ROUTE_CONTEXT.jurisdiction,version:URN_VERSION,sector:EXAMPLE_TENANT_ROUTE_CONTEXT.sector,idType:URN_ORGANIZATION_ID_TYPE,idValue:EXAMPLE_LEGAL_ORGANIZATION_TAX_ID,email:EXAMPLE_CONTROLLER_EMAIL,role});
  const key=deriveDeterministicEcJwkPair({seed:EXAMPLE_DEVICE_CLIENT_ID,purpose:'registered-professional-vp'}).publicJwk;
  const keyId=tryGetJwkThumbprint(key)!;
  const links=buildProfessionalAssignmentLedgerPayload({assignmentIdentifier:employeeUrn,employeeIdentifier:EXAMPLE_PROFESSIONAL_DID,organizationIdentifier:EXAMPLE_PROVIDER_ORGANIZATION_DID,role});
  const binding=buildStoredSubjectKeyBindingAsset({stub:{getTxTimestamp:()=>({seconds:1}),getTxID:()=>keyId}},`employee_${employeeUrn}__${keyId}`,{subjectType:'employee',subjectId:employeeUrn,keyId,relationship:'employee-device-signing',status:'active',professionalAssignmentLink:links.assignmentLink,employeeLink:links.employeeLink,organizationLink:links.organizationLink});
  const asset={keyId,thumbprint:keyId,status:'active'};
  const assignment={...links,status:'active'};
  const identity={actorDid:EXAMPLE_PROFESSIONAL_DID,acr:'urn:antifraud:acr:openid4vp:employee',employeeUrn,role,stableActorIdentifier:buildStableActorIdentifier({contactKind:'email',contact:EXAMPLE_CONTROLLER_EMAIL})};
  const now=Math.floor(Date.now()/1000);
  const profile={clientId:EXAMPLE_DEVICE_CLIENT_ID,subjectId:employeeUrn,activationCode:EXAMPLE_DEVICE_CLIENT_ID,jwks:{keys:[key]},stableActorIdentifier:buildStableActorIdentifier({contactKind:'email',contact:EXAMPLE_CONTROLLER_EMAIL})};
  const licence={status:'active',exp:now+600,subjectId:employeeUrn,activationCode:profile.activationCode,issuedToRole:role,deviceBindings:[{clientId:profile.clientId,status:'active'}]};
  const employee={status:'active',didDocument:{id:EXAMPLE_PROFESSIONAL_DID,alsoKnownAs:[employeeUrn]},claims:{[ClaimsPersonSchemaorg.email]:EXAMPLE_CONTROLLER_EMAIL,[ClaimsPersonSchemaorg.hasOccupation]:role}};
  const profileDocument={status:'active',jwe:'unit-protected-profile',opened:profile},licenceDocument={status:'active',jwe:'unit-protected-licence',opened:licence},employeeDocument={status:'active',jwe:'unit-protected-employee',opened:employee};
  const repository={get:async(_vault:string,_id:string,section:string)=>section===getEnvSectionId('device-profiles')?profileDocument:section===getEnvSectionId('employees')?employeeDocument:undefined,getContainersInSection:async()=>[licenceDocument]};
  const keyRead=jest.spyOn(ManageAssetCryptographicKey.prototype,'read').mockImplementation(async()=>asset as any);
  const bindingRead=jest.spyOn(ManageAssetSubjectKeyBinding.prototype,'read').mockImplementation(async()=>binding);
  const assignmentRead=jest.spyOn(ManageAssetProfessionalAssignment.prototype,'read').mockImplementation(async()=>assignment as any);
  const unsupportedRead=jest.spyOn(ManageAsset.prototype,'read').mockImplementation(async()=>{throw new Error('Unexpected additional contract read');});
  const vp=await buildDeterministicSignedJwt({seed:EXAMPLE_DEVICE_CLIENT_ID,purpose:'registered-professional-vp',payload:{iss:EXAMPLE_DEVICE_CLIENT_ID,aud:EXAMPLE_PROVIDER_ORGANIZATION_DID,...buildProfessionalIdentityVpPayload({clientId:EXAMPLE_DEVICE_CLIENT_ID,actorDid:EXAMPLE_PROFESSIONAL_DID,role})}});
  const verifier=buildLocalClearingHouseVerifier({network:'local-network',ledgerKind:'fabric',ledger:new CredentialLedgerAdapterMem(),tenants:{getDidDocument:async()=>({id:EXAMPLE_PROVIDER_ORGANIZATION_DID}),isTenantOperational:async()=>true,getCollectionName:async()=>EXAMPLE_DEVICE_CLIENT_ID} as any,kmsService:{unprotectConfidentialData:async(doc:any)=>doc.opened} as any,vaultRepository:repository as any,cryptography:{} as any,authorize:async()=>{throw new Error('Unexpected scoped request');}});
  const verify=()=>verifier.verifyVpToken({tenantDid:EXAMPLE_PROVIDER_ORGANIZATION_DID,tenantVaultId:EXAMPLE_DEVICE_CLIENT_ID,holderVaultId:EXAMPLE_DEVICE_CLIENT_ID,authenticatedClientId:EXAMPLE_DEVICE_CLIENT_ID,tokenSubject:EXAMPLE_PROFESSIONAL_DID,vpToken:vp.compactToken,acrValues:[identity.acr]});
  return{binding,asset,assignment,licence,profile,employee,verify,unsupportedRead,keyRead,bindingRead,assignmentRead};
 }
 it('accepts the canonical binding without role licence fields or an additional contract',async()=>{const f=await fixture();expect(f.binding).not.toHaveProperty('licensedRole');expect(f.binding).not.toHaveProperty('roleLicenseId');await expect(f.verify()).resolves.toMatchObject({ledgerVerified:true});expect(f.unsupportedRead).not.toHaveBeenCalled();expect(f.assignmentRead).toHaveBeenCalled();});
 it.each([
  ['revoked key','asset','status','revoked'],
  ['wrong key thumbprint','asset','thumbprint','different-key'],
  ['revoked binding','binding','status','revoked'],
  ['wrong binding subject type','binding','subjectType','person'],
  ['wrong binding employee','binding','subjectId','different-employee'],
  ['wrong binding key','binding','keyId','different-key'],
  ['missing assignment link','binding','professionalAssignmentLink',undefined],
  ['inactive assignment','assignment','status','suspended'],
  ['wrong assignment link','assignment','assignmentLink','different-assignment'],
  ['wrong assignment employee','assignment','employeeLink','different-employee'],
  ['wrong assignment organization','assignment','organizationLink','different-organization'],
  ['wrong assignment role','assignment','role','RESPRSN'],
 ])('rejects %s',async(_label,target,field,value)=>{const f=await fixture();(f as any)[target as string][field as string]=value;await expect(f.verify()).rejects.toThrow();expect(f.unsupportedRead).not.toHaveBeenCalled();});
 it('preserves rejection from the current protected licence verifier',async()=>{const f=await fixture();f.licence.status='revoked';await expect(f.verify()).rejects.toThrow(/licence/);expect(f.bindingRead).not.toHaveBeenCalled();});
});
