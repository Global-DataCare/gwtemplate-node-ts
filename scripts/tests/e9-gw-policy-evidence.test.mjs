// Flow contract: accept only fresh GW CORE 1.26.0 policy evidence with real result references, exact hashes, no failed/skipped cases, and separate source/image layers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyGatewayPolicyEvidence} from '../verify-e9-gw-policy-evidence.mjs';

function fixture(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gw-policy-evidence-'));
  const result = {success:true,numTotalTests:3,numPassedTests:3,numFailedTests:0,numPendingTests:0,testResults:[{assertionResults:[
    {fullName:'valid identity and authorized policy',status:'passed'},
    {fullName:'reject invalid identity',status:'passed'},
    {fullName:'deny missing consent',status:'passed'},
  ]}]};
  const raw=JSON.stringify(result);writeFileSync(path.join(dir,'results.json'),raw);
  const log='completed\n';writeFileSync(path.join(dir,'run.log'),log);
  const file=(name,bytes)=>({path:name,sha256:createHash('sha256').update(bytes).digest('hex')});
  const m={gateway:{version:'1.26.0',sourceCommit:'01f36c02877fb2da7a55538320ab69d0dc2e84b9',image:'ghcr.io/global-datacare/gw-core@sha256:a19ba9f712642da6a715e0039352204fc21d7546a6dfcd86cd8f17f26158c2f8'},runs:[{
    id:'source-policy',layer:'source',node:'v26.13.0',command:['node','scripts/run-jest.mjs'],exitCode:0,
    log:file('run.log',log),results:file('results.json',raw),cases:[
      {name:'valid identity and authorized policy',category:'policy-positive'},
      {name:'reject invalid identity',category:'identity-negative'},
      {name:'deny missing consent',category:'policy-negative'},
    ],tests:{total:3,passed:3,failed:0,skipped:0},
  }]};
  try{run({dir,m});}finally{rmSync(dir,{recursive:true,force:true});}
}

test('accepts exact completed results and keeps classification separate from totals',()=>fixture(({dir,m})=>assert.deepEqual(verifyGatewayPolicyEvidence(m,dir),[])));
test('rejects relabelled historical gateway version',()=>fixture(({dir,m})=>{m.gateway.version='1.25.33';assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/1.26.0/);}));
test('rejects a mutable image tag',()=>fixture(({dir,m})=>{m.gateway.image='gw-core:latest';assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/digest/);}));
test('rejects failed processes even with passing JSON',()=>fixture(({dir,m})=>{m.runs[0].exitCode=1;assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/exit/);}));
test('rejects changed evidence',()=>fixture(({dir,m})=>{writeFileSync(path.join(dir,'run.log'),'changed');assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/hash/);}));
test('rejects invented case names',()=>fixture(({dir,m})=>{m.runs[0].cases[0].name='invented';assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/case/);}));
test('rejects absent invalid-identity coverage',()=>fixture(({dir,m})=>{m.runs[0].cases=m.runs[0].cases.filter(c=>c.category!=='identity-negative');assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/identity-negative/);}));
test('rejects omitted tests in a completed suite',()=>fixture(({dir,m})=>{const r={success:true,numFailedTests:0,numPendingTests:1,testResults:[]};const raw=JSON.stringify(r);writeFileSync(path.join(dir,'results.json'),raw);m.runs[0].results.sha256=createHash('sha256').update(raw).digest('hex');assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/pending/);}));
test('rejects a different release commit even with the correct version label',()=>fixture(({dir,m})=>{m.gateway.sourceCommit='b'.repeat(40);assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/release commit/);}));
test('rejects a different immutable image',()=>fixture(({dir,m})=>{m.gateway.image='ghcr.io/global-datacare/gw-core@sha256:'+'b'.repeat(64);assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/release image/);}));
test('rejects counting a case twice',()=>fixture(({dir,m})=>{m.runs[0].cases.push({...m.runs[0].cases[0]});assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/duplicate case/);}));
test('rejects invented totals even with genuine passing results',()=>fixture(({dir,m})=>{m.runs[0].tests.total=400;m.runs[0].tests.passed=400;assert.match(verifyGatewayPolicyEvidence(m,dir).join('\n'),/counter/);}));

function addFabric({dir,m}) {
  const flows=['individual-consent-smart-scoped-summary','individual-consent-smart-bundle-search','medical-secretary-consent-smart-bundle-search-allow','medical-secretary-without-consent-smart-token-deny','research-contract-consent-smart-digitaltwin-search-role-allow','research-contract-consent-smart-digitaltwin-search-role-deny','research-contract-consent-smart-digitaltwin-search-email-allow','research-contract-consent-smart-digitaltwin-search-email-deny'];
  const log=JSON.stringify({verifiedFlows:flows})+'\nValidated image: '+m.gateway.image+'\n';
  writeFileSync(path.join(dir,'fabric.log'),log);
  m.fabric={image:m.gateway.image,runtime:{version:'1.26.0',node:'v26.13.0'},exitCode:0,flowCount:8,allowed:5,denied:3,verifiedFlows:flows,log:{path:'fabric.log',sha256:createHash('sha256').update(log).digest('hex')}};
}
test('accepts separately recorded published-image journeys',()=>fixture(f=>{addFabric(f);assert.deepEqual(verifyGatewayPolicyEvidence(f.m,f.dir),[]);}));
test('rejects a different running image version',()=>fixture(f=>{addFabric(f);f.m.fabric.runtime.version='1.25.24';assert.match(verifyGatewayPolicyEvidence(f.m,f.dir).join('\n'),/runtime/);}));
test('rejects image journey counts that disagree with the completed log',()=>fixture(f=>{addFabric(f);f.m.fabric.flowCount=99;assert.match(verifyGatewayPolicyEvidence(f.m,f.dir).join('\n'),/flow.*counter/);}));
