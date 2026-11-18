// Flow contract: secure local E2E owns its leased loopback listeners and child processes. Cleanup with no owned service must never invoke a general port closer, and every child receives the leased gateway address rather than a fixed shared port.
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,access,rm,readdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawn,spawnSync} from 'node:child_process'
import test from 'node:test'
import {createServer} from 'node:http'
import {acquirePortLease,portsAvailable,runOwnedScript,assertOwnedListener} from '../secure-e2e-owned-runtime.mjs'
const launcher=fileURLToPath(new URL('../run-secure-e2e-google-user.sh',import.meta.url))
const source=await readFile(launcher,'utf8')

test('cleanup with no owned gateway leaves an unrelated port closer untouched',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-owned-cleanup-'))
 try{
  await mkdir(join(dir,'scripts'))
  await writeFile(join(dir,'scripts/local-close.sh'),'#!/bin/bash\nprintf called > "$GW_PROJECT_ROOT/unknown-port-close-called"\n')
  const start=source.indexOf('\ncleanup_gw() {'),end=source.indexOf('\ncleanup() {',start)
  assert.ok(start>=0&&end>start,'existing canonical cleanup function remains inspectable')
  const result=spawnSync('bash',['-c',source.slice(start,end)+'\ncleanup_gw\n'],{env:{...process.env,GW_PROJECT_ROOT:dir,GW_PID:'',SCRIPT_DIR:join(dir,'scripts')},encoding:'utf8'})
  assert.equal(result.status,0,result.stderr)
  await assert.rejects(access(join(dir,'unknown-port-close-called')),{code:'ENOENT'})
 }finally{await rm(dir,{recursive:true,force:true})}
})

test('gateway and ICA addresses are derived from their allocated local port lease',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-owned-address-'))
 try{
  const start=source.indexOf('\nRUN_ID='),end=source.indexOf('\ncleanup_gw() {',start)
  assert.ok(start>=0&&end>start)
  const result=spawnSync('bash',['-c',source.slice(start,end)+'\nprintf "%s\\n%s\\n" "$BASE_URL" "$ICA_BASE_URL"\n'],{
   env:{...process.env,GW_PROJECT_ROOT:dir,CORE_E2E_GW_PORT:'28744',CORE_E2E_ICA_PORT:'28745',BASE_URL:'',ICA_PORT:'',ICA_BASE_URL:'',LIVE_GW_RESULTS_DIR:dir},encoding:'utf8',
  })
  assert.equal(result.status,0,result.stderr)
  assert.equal(result.stdout,'http://127.0.0.1:28744\nhttp://127.0.0.1:28745\n')
 }finally{await rm(dir,{recursive:true,force:true})}
})

const runtimeHelper=fileURLToPath(new URL('../secure-e2e-owned-runtime.mjs',import.meta.url))
const pause=ms=>new Promise(done=>setTimeout(done,ms))
async function untilFile(path){
 for(let n=0;n<150;n++){try{return JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error;await pause(20)}}
 throw new Error('owned child did not become ready')
}
async function sentinel(){
 const server=createServer((_,response)=>response.end('unrelated-listener'))
 await new Promise(done=>server.listen(0,'127.0.0.1',done))
 return {port:server.address().port,async verify(){assert.equal(await(await fetch(`http://127.0.0.1:${server.address().port}`)).text(),'unrelated-listener')},close:()=>new Promise(done=>server.close(done))}
}
async function fixtureRuntime(dir){
 const child=join(dir,'grandchild.mjs'),parent=join(dir,'parent.mjs'),script=join(dir,'run.sh'),state=join(dir,'ready.json')
 await writeFile(child,`import {createServer} from 'node:http';const server=createServer((_,r)=>r.end('owned'));server.listen(Number(process.env.CORE_E2E_GW_PORT),'127.0.0.1',()=>process.send({pid:process.pid}));`)
 await writeFile(parent,`import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,[process.env.CHILD_SCRIPT],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',message=>writeFileSync(process.env.STATE_FILE,JSON.stringify({parentPid:process.pid,childPid:message.pid,gwPort:Number(process.env.CORE_E2E_GW_PORT),icaPort:Number(process.env.CORE_E2E_ICA_PORT)})));setInterval(()=>{},1000);`)
 await writeFile(script,'#!/bin/bash\nnode "$PARENT_SCRIPT" &\nowned_root=$!\nwhile [[ ! -f "$STATE_FILE" ]]; do sleep 0.01; done\nif [[ "$MODE" == tree ]]; then node "$RUNTIME_HELPER" stop-tree "$owned_root" "$$"; exit 0; fi\nif [[ "$MODE" == fail ]]; then exit 7; fi\nwait\n')
 return {script,state,env:{...process.env,PARENT_SCRIPT:parent,CHILD_SCRIPT:child,STATE_FILE:state,RUNTIME_HELPER:runtimeHelper}}
}

test('atomic leases reject occupied or already leased blocks without changing their owner',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-port-lease-')),other=await sentinel()
 let first,second
 try{
  first=await acquirePortLease({root:dir})
  await assert.rejects(acquirePortLease({root:dir,basePort:first.gwPort}),/port_block_unavailable/u)
  const owner=JSON.parse(await readFile(join(first.directory,'owner.json'),'utf8'))
  assert.equal(owner.ownerPid,process.pid)
  await first.release();first=undefined
  if(other.port<=65532)await assert.rejects(acquirePortLease({root:dir,basePort:other.port}),/port_block_unavailable/u)
  second=await acquirePortLease({root:dir});assert.equal(await portsAvailable(second.ports),true)
  await other.verify()
 }finally{if(first)await first.release();if(second)await second.release();await other.close();await rm(dir,{recursive:true,force:true})}
})

for(const mode of ['fail','tree'])test(`owned ${mode} cleanup stops actual child/grandchild listeners and preserves an unrelated listener`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-owned-process-')),other=await sentinel()
 try{
  const fixture=await fixtureRuntime(dir),leaseRoot=join(dir,'leases')
  const status=await runOwnedScript(fixture.script,[],{env:{...fixture.env,MODE:mode},leaseRoot})
  assert.equal(status,mode==='fail'?7:0)
  const state=await untilFile(fixture.state)
  assert.notEqual(state.gwPort,state.icaPort)
  assert.equal(await portsAvailable([state.gwPort,state.icaPort]),true)
  assert.deepEqual(await readdir(leaseRoot),[])
  await other.verify()
 }finally{await other.close();await rm(dir,{recursive:true,force:true})}
})

test('SIGTERM to the supervisor stops its whole owned group before releasing the port lease',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'core-owned-signal-')),other=await sentinel()
 let child,exited
 try{
  const fixture=await fixtureRuntime(dir),leaseRoot=join(dir,'leases')
  child=spawn(process.execPath,[runtimeHelper,'run-script',fixture.script],{env:{...fixture.env,MODE:'wait',CORE_E2E_LEASE_ROOT:leaseRoot},stdio:'ignore'})
  exited=new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}))})
  const state=await untilFile(fixture.state)
  child.kill('SIGTERM')
  assert.deepEqual(await exited,{code:143,signal:null})
  assert.equal(await portsAvailable([state.gwPort,state.icaPort]),true)
  assert.deepEqual(await readdir(leaseRoot),[])
  await other.verify()
 }finally{if(child?.exitCode===null){child.kill('SIGTERM');await exited}await other.close();await rm(dir,{recursive:true,force:true})}
})

test('a successful HTTP probe cannot adopt a listener belonging to another process group',async()=>{
 const other=await sentinel()
 try{await assert.rejects(assertOwnedListener(other.port,999999),/listener_not_owned/u);await other.verify()}
 finally{await other.close()}
})
