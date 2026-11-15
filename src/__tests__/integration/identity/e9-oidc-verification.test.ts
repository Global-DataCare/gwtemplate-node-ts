// Flow contract: 1. Start an owned local OIDC/JWKS server. 2. Sign canonical identities with real ES384 keys. 3. Accept the trusted identity. 4. Reject malformed, tampered, expired, premature, wrong-audience, wrong-issuer and removed-key tokens. 5. Close the owned server. No mock replaces signature verification or HTTP; no business data or ledger writes occur.
import {createServer, type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {GenericOidcTokenVerifier} from '../../../auth/GenericOidcTokenVerifier';
import {TrustedOidcTokenVerifier} from '../../../auth/TrustedOidcTokenVerifier';
import {buildDeterministicSignedJwt} from '../../utils/deterministic-jwt-fixtures';
import {EXAMPLE_CONTROLLER_DID} from 'gdc-common-utils-ts/examples/shared';

describe('E9 real OIDC identity verification',()=>{
  let server:Server;let issuer:string;let publishedKeys:any[];let discoveryIssuer:string;
  const now=()=>Math.floor(Date.now()/1000);
  async function token(overrides:Record<string,unknown>={}){
    return buildDeterministicSignedJwt({seed:EXAMPLE_CONTROLLER_DID,purpose:'e9-local-oidc-verifier',alg:'ES384',payload:{iss:issuer,aud:issuer,sub:EXAMPLE_CONTROLLER_DID,iat:now(),exp:now()+120,...overrides}});
  }
  const verifier=()=>new GenericOidcTokenVerifier({issuer,audience:issuer});
  beforeAll(async()=>{
    server=createServer((req,res)=>{res.setHeader('content-type','application/json');
      if(req.url==='/.well-known/openid-configuration')res.end(JSON.stringify({issuer:discoveryIssuer,jwks_uri:issuer+'/jwks'}));
      else if(req.url==='/jwks')res.end(JSON.stringify({keys:publishedKeys}));
      else{res.statusCode=404;res.end('{}');}
    });
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    issuer=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(async()=>{discoveryIssuer=issuer;publishedKeys=[(await token()).publicJwk];});
  afterAll(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));});
  it('[ID-P01] accepts a correctly signed identity through actual discovery and JWKS HTTP',async()=>{
    const t=await token();const result=await verifier().verify(t.compactToken);expect(result.valid).toBe(true);expect(result.payload?.sub).toBe(EXAMPLE_CONTROLLER_DID);
  });
  it('[ID-N01] rejects a payload modified after signing',async()=>{
    const t=await token();const parts=t.compactToken.split('.');parts[1]=Buffer.from(JSON.stringify({...t.payload,sub:issuer})).toString('base64url');const r=await verifier().verify(parts.join('.'));expect(r.valid).toBe(false);expect(r.error).toMatch(/signature verification failed/i);
  });
  it('[ID-N02] rejects an expired signed identity',async()=>{const r=await verifier().verify((await token({exp:now()-60})).compactToken);expect(r.valid).toBe(false);expect(r.error).toMatch(/exp.*claim.*failed|expired/i);});
  it('[ID-N03] rejects an identity not yet valid',async()=>{const r=await verifier().verify((await token({nbf:now()+120})).compactToken);expect(r.valid).toBe(false);expect(r.error).toMatch(/nbf.*claim.*failed/i);});
  it('[ID-N04] rejects a signed identity intended for another audience',async()=>{const r=await verifier().verify((await token({aud:EXAMPLE_CONTROLLER_DID})).compactToken);expect(r.valid).toBe(false);expect(r.error).toMatch(/aud.*claim/i);});
  it('[ID-N05] rejects a signed identity from another issuer',async()=>{const r=await verifier().verify((await token({iss:EXAMPLE_CONTROLLER_DID})).compactToken);expect(r.valid).toBe(false);expect(r.error).toMatch(/iss.*claim/i);});
  it('[ID-N06] rejects a key absent from the current issuer key set',async()=>{const t=await token();publishedKeys=[];const r=await verifier().verify(t.compactToken);expect(r.valid).toBe(false);expect(r.error).toMatch(/no applicable key/i);});
  it('[ID-N07] rejects a discovery document impersonating another issuer',async()=>{discoveryIssuer=EXAMPLE_CONTROLLER_DID;const r=await verifier().verify((await token()).compactToken);expect(r.valid).toBe(false);expect(r.error).toMatch(/issuer does not match/i);});
  it('[ID-N08] rejects an issuer outside the explicitly trusted providers',async()=>{const v=new TrustedOidcTokenVerifier([{issuer,audience:issuer}]);const r=await v.verify((await token({iss:EXAMPLE_CONTROLLER_DID})).compactToken);expect(r.valid).toBe(false);expect(r.error).toMatch(/untrusted.*issuer/i);});
  it('[ID-N09] rejects malformed credentials before trusting any issuer',async()=>{const v=new TrustedOidcTokenVerifier([{issuer,audience:issuer}]);const r=await v.verify('not-a-jwt');expect(r.valid).toBe(false);expect(r.error).toMatch(/invalid.*structure/i);});
});
