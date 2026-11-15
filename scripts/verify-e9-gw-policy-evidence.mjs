// Flow contract: validate a version-bound E9 gateway policy supplement without rewriting historical suite counts.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function verifyGatewayPolicyEvidence(manifest, directory) {
  const errors=[];const categories=new Set();const seen=new Set();
  if(manifest?.gateway?.version!=='1.26.0')errors.push('gateway version must be 1.26.0');
  if(!/^[a-f0-9]{40}$/.test(manifest?.gateway?.sourceCommit||''))errors.push('exact source commit required');
  if(!/^ghcr\.io\/global-datacare\/gw-core@sha256:[a-f0-9]{64}$/.test(manifest?.gateway?.image||''))errors.push('immutable published image digest required');
  if(manifest?.gateway?.sourceCommit!=='01f36c02877fb2da7a55538320ab69d0dc2e84b9')errors.push('GW CORE 1.26.0 release commit mismatch');
  if(manifest?.gateway?.image!=='ghcr.io/global-datacare/gw-core@sha256:a19ba9f712642da6a715e0039352204fc21d7546a6dfcd86cd8f17f26158c2f8')errors.push('GW CORE 1.26.0 release image mismatch');
  function read(file){
    const base=path.resolve(directory);const target=path.resolve(base,file?.path||'');
    if(!target.startsWith(base+path.sep))throw new Error('evidence path outside directory');
    const bytes=readFileSync(target);
    if(createHash('sha256').update(bytes).digest('hex')!==file?.sha256)throw new Error('evidence hash mismatch');
    return bytes.toString('utf8');
  }
  if(!Array.isArray(manifest?.runs)||!manifest.runs.length)errors.push('completed runs required');
  for(const run of manifest?.runs||[]){
    try{
      if(seen.has(run.id))throw new Error('duplicate run');seen.add(run.id);
      if(run.exitCode!==0)throw new Error('process exit must be zero');
      if(run.node!=='v26.13.0')throw new Error('approved runtime required');
      if(run.layer!=='source')throw new Error('Jest source results must not be labelled as image evidence');
      if(!Array.isArray(run.command)||!run.command.length)throw new Error('exact command required');
      read(run.log);const result=JSON.parse(read(run.results));
      if(!result.success||result.numFailedTests!==0||result.numPendingTests!==0)throw new Error('failed or pending tests');
      const assertions=(result.testResults||[]).flatMap(s=>s.assertionResults||[]);
      if(!assertions.length||assertions.some(a=>a.status!=='passed'))throw new Error('every test must pass without omissions');
      if(result.numTotalTests!==assertions.length||result.numPassedTests!==assertions.length||run.tests?.total!==assertions.length||run.tests?.passed!==assertions.length||run.tests?.failed!==0||run.tests?.skipped!==0)throw new Error('declared counters disagree with completed cases');
      const seenCases=new Set();
      for(const c of run.cases||[]){
        if(seenCases.has(c.name))throw new Error('duplicate case');seenCases.add(c.name);
        if(!assertions.some(a=>a.fullName===c.name&&a.status==='passed'))throw new Error('case has no completed result: '+c.name);
        categories.add(c.category);
      }
    }catch(e){errors.push(`${run.id}: ${e.message}`);}
  }
  for(const category of ['policy-positive','identity-negative','policy-negative'])if(!categories.has(category))errors.push('missing coverage: '+category);
  if(manifest?.fabric){
    try{
      const f=manifest.fabric;
      if(f.runtime?.version!=='1.26.0'||f.runtime?.node!=='v26.13.0')throw new Error('running image runtime mismatch');
      if(f.exitCode!==0||f.image!==manifest.gateway.image)throw new Error('image command or digest mismatch');
      const log=read(f.log);const match=log.match(/"verifiedFlows":\s*(\[[\s\S]*?\])/);
      if(!match||!log.includes('Validated image: '+f.image))throw new Error('completed image flow summary missing');
      const flows=JSON.parse(match[1]);const denied=flows.filter(s=>s.endsWith('-deny')).length;
      if(flows.length!==8||new Set(flows).size!==8||denied!==3||f.flowCount!==flows.length||f.denied!==denied||f.allowed!==flows.length-denied||JSON.stringify(f.verifiedFlows)!==JSON.stringify(flows))throw new Error('image flow counters disagree with completed log');
    }catch(e){errors.push('fabric: '+e.message);}
  }
  return errors;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const file=path.resolve(process.argv[2]);const errors=verifyGatewayPolicyEvidence(JSON.parse(readFileSync(file,'utf8')),path.dirname(file));if(errors.length)throw new Error(errors.join('\n'));console.log('GW CORE 1.26.0 policy evidence: version, hashes, completed cases and negative coverage verified.');}
  catch(e){console.error(e.message);process.exitCode=1;}
}
