// Flow contract: lease one local port block, supervise the exact launched process group and release only after owned descendants/listeners have stopped. Never stop a process by port or name.
import {spawn,execFile} from 'node:child_process'
import {mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {randomUUID,randomInt} from 'node:crypto'
import {promisify} from 'node:util'
const execute=promisify(execFile)
const delay=ms=>new Promise(done=>setTimeout(done,ms))
const validPid=value=>Number.isSafeInteger(Number(value))&&Number(value)>1
async function processes(){
 const {stdout}=await execute('ps',['-axo','pid=,ppid=,pgid=,stat='])
 return stdout.trim().split('\n').filter(Boolean).map(line=>{const [pid,parent,group,status]=line.trim().split(/\s+/u);return {pid:Number(pid),parent:Number(parent),group:Number(group),status}})
}
export async function portsAvailable(ports){
 const opened=[]
 try{
  for(const port of ports){
   const server=createServer();opened.push(server)
   await new Promise((done,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',done)})
  }
  return true
 }catch{return false}
 finally{await Promise.all(opened.map(server=>new Promise(done=>server.listening?server.close(done):done())))}
}
export async function acquirePortLease({root=join(tmpdir(),`gw-core-secure-e2e-leases-${process.getuid?.()??'local'}`),basePort}={}){
 await mkdir(root,{recursive:true,mode:0o700})
 if(basePort!==undefined&&(!Number.isSafeInteger(basePort)||basePort<1024||basePort>65532))throw new Error('secure_e2e_port_base_invalid')
 const first=randomInt(500),candidates=basePort===undefined?Array.from({length:500},(_,n)=>28000+((first+n)%500)*4):[basePort]
 for(const base of candidates){
  const directory=join(root,`${base}.lock`),runId=randomUUID(),ports=[base,base+1,base+2,base+3]
  try{await mkdir(directory,{mode:0o700})}catch(error){if(error.code==='EEXIST')continue;throw error}
  try{
   await writeFile(join(directory,'owner.json'),JSON.stringify({ownerPid:process.pid,runId,ports}),{mode:0o600})
   if(!await portsAvailable(ports)){await rm(directory,{recursive:true,force:true});continue}
   return {directory,runId,ports,gwPort:base,icaPort:base+1,async release(){
    const owner=JSON.parse(await readFile(join(directory,'owner.json'),'utf8'))
    if(owner.ownerPid!==process.pid||owner.runId!==runId)throw new Error('secure_e2e_lease_owner_changed')
    await rm(directory,{recursive:true,force:true})
   }}
  }catch(error){await rm(directory,{recursive:true,force:true});throw error}
 }
 throw new Error('secure_e2e_port_block_unavailable')
}
export async function stopOwnedTree(rootPid,group){
 rootPid=Number(rootPid);group=Number(group)
 if(!validPid(rootPid)||!validPid(group)||rootPid===process.pid)throw new Error('secure_e2e_process_owner_required')
 const inventory=await processes(),root=inventory.find(row=>row.pid===rootPid)
 if(!root)return
 if(root.group!==group)throw new Error('secure_e2e_process_group_mismatch')
 const owned=new Set([rootPid]);let changed=true
 while(changed){changed=false;for(const row of inventory)if(row.group===group&&owned.has(row.parent)&&!owned.has(row.pid)){owned.add(row.pid);changed=true}}
 const signal=async name=>{
  const current=await processes()
  for(const pid of [...owned].reverse())if(current.some(row=>row.pid===pid&&row.group===group&&!row.status.startsWith('Z'))){try{process.kill(pid,name)}catch(error){if(error.code!=='ESRCH')throw error}}
 }
 await signal('SIGTERM')
 for(let attempt=0;attempt<20;attempt++){
  if(!(await processes()).some(row=>owned.has(row.pid)&&row.group===group&&!row.status.startsWith('Z')))return
  await delay(50)
 }
 await signal('SIGKILL')
}
async function stopGroup(group){
 if(!validPid(group))return
 const signal=name=>{try{process.kill(-group,name)}catch(error){if(error.code!=='ESRCH')throw error}}
 const alive=async()=> (await processes()).some(row=>row.group===group&&!row.status.startsWith('Z'))
 if(!await alive())return
 signal('SIGTERM')
 for(let attempt=0;attempt<20;attempt++){if(!await alive())return;await delay(50)}
 signal('SIGKILL')
 for(let attempt=0;attempt<20;attempt++){if(!await alive())return;await delay(50)}
 throw new Error('secure_e2e_owned_processes_remain')
}
export async function assertOwnedListener(port,group){
 port=Number(port);group=Number(group)
 if(!Number.isInteger(port)||port<1||port>65535||!validPid(group))throw new Error('secure_e2e_listener_owner_required')
 const {stdout}=await execute('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-t'])
 const pids=[...new Set(stdout.trim().split(/\s+/u).map(Number))],inventory=await processes()
 if(!pids.length||pids.some(pid=>!validPid(pid)||!inventory.some(row=>row.pid===pid&&row.group===group)))throw new Error('secure_e2e_listener_not_owned')
}
export async function runOwnedScript(script,args=[],{env=process.env,leaseRoot,basePort}={}){
 if(process.platform==='win32')throw new Error('secure_e2e_owned_process_groups_require_posix')
 const lease=await acquirePortLease({root:leaseRoot,basePort})
 let child,stopping,receivedSignal
 const stop=()=>child?.pid?(stopping??=stopGroup(child.pid)):Promise.resolve()
 const handlers=new Map(['SIGINT','SIGTERM'].map(name=>[name,()=>{receivedSignal=name;void stop().catch(()=>{})}]))
 for(const [name,handler]of handlers)process.once(name,handler)
 try{
  child=spawn('bash',[resolve(script),...args],{detached:true,stdio:'inherit',env:{...env,
   CORE_E2E_OWNED_RUNTIME:lease.runId,CORE_E2E_GW_PORT:String(lease.gwPort),CORE_E2E_ICA_PORT:String(lease.icaPort),
   BASE_URL:`http://127.0.0.1:${lease.gwPort}`,ICA_PORT:String(lease.icaPort),ICA_BASE_URL:`http://127.0.0.1:${lease.icaPort}`,
  }})
  if(receivedSignal)await stop()
  const result=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}))})
  await stop()
  if(!await portsAvailable(lease.ports))throw new Error('secure_e2e_listener_remains_after_cleanup')
  return receivedSignal==='SIGINT'?130:receivedSignal==='SIGTERM'?143:result.code??1
 }finally{
  let stopped=false
  try{await stop();stopped=true}finally{
   for(const [name,handler]of handlers)process.removeListener(name,handler)
   if(stopped&&await portsAvailable(lease.ports))await lease.release()
  }
 }
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??'')).href){
 try{
  if(process.version!=='v26.13.0')throw new Error('secure_e2e_node_26_13_required')
  const [mode,...args]=process.argv.slice(2)
  if(mode==='run-script')process.exitCode=await runOwnedScript(args[0],args.slice(1),{leaseRoot:process.env.CORE_E2E_LEASE_ROOT,basePort:process.env.CORE_E2E_PORT_BASE?Number(process.env.CORE_E2E_PORT_BASE):undefined})
  else if(mode==='stop-tree')await stopOwnedTree(args[0],args[1])
  else if(mode==='assert-listener')await assertOwnedListener(args[0],args[1])
  else throw new Error('secure_e2e_runtime_command_invalid')
 }catch(error){console.error(error.message);process.exitCode=1}
}
