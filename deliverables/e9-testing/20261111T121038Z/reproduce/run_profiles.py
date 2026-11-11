"""Execute both existing profile E2Es after real tenant/consent provisioning."""
import datetime
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request

script_root = Path(__file__).resolve().parent
root = Path(os.environ.get('E9_OUTPUT_ROOT', script_root))
workspace = Path(os.environ.get('E9_WORKSPACE_ROOT', script_root.parent.parent))
phase = sys.argv[1] if len(sys.argv) > 1 else 'profiles'
worktrees = Path(os.environ.get('E9_WORKTREES_ROOT', workspace / '.codex-worktrees'))
gw = worktrees / 'e9-repair-gwtemplate-node-ts'
ica = worktrees / 'e9-repair-dataspace-ica-ts'
sdk = worktrees / 'e9-repair-gdc-sdk-node-ts'
assert subprocess.check_output(['node','--version'], text=True).strip() == 'v26.13.0'
for port in [33300,33310]:
    with socket.socket() as probe: probe.bind(('127.0.0.1',port))
examples_source = "import * as e from 'gdc-common-utils-ts/examples'; console.log(JSON.stringify(Object.fromEntries(['EXAMPLE_SUBJECT_DID','EXAMPLE_PROFESSIONAL_DID','EXAMPLE_DEVICE_CLIENT_ID','EXAMPLE_EMAIL_PROFESSIONAL','EXAMPLE_HEALTHCARE_ACTOR_ROLE_GENERALIST_MEDICAL_PRACTITIONER'].map(k=>[k,e[k]]))));"
examples = json.loads(subprocess.check_output(['node','--input-type=module','-e',examples_source],cwd=sdk,text=True))
run_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dt%H%M%S')
base = dict(os.environ, NODE_ENV='demo', SECURITY_MODE='demo', NETWORK_MODE='test',
            DB_PROVIDER='mem', STORAGE_PROVIDER='mem', QUEUE_PROVIDER='mem', KMS_PROVIDER='memory',
            DEV_SEED='true', DEMO_ALLOW_INSECURE_BEARER='true', AUTH_TOKEN_VERIFIER='demo',
            ALLOWED_SECTORS='health-care,health-research,health-index,test',
            HOST_INTERNAL_IP='127.0.0.1',HOST_INTERNAL_PORT='33300',HOST_ID_VALUE='e9-'+run_id+'-host',
            ICA_API_HOST='127.0.0.1',ICA_API_PORT='33310',DID_WEB_DOMAIN='localhost:33310',
            ICA_URL_INTERNAL='http://127.0.0.1:33310',ICA_URL_EXTERNAL='http://127.0.0.1:33310',
            ICA_JURISDICTION='ES',ICA_KNOWN_CERTS_AUTO_DOWNLOAD='true',
            TS_NODE_TRANSPILE_ONLY='1',TS_NODE_SKIP_IGNORE='1',
            TS_NODE_COMPILER_OPTIONS=json.dumps({'module':'NodeNext','moduleResolution':'NodeNext','allowImportingTsExtensions':True}))
test_env = {
    'BASE_URL':'http://127.0.0.1:33300','TENANT_ID':'e9-'+run_id,'TENANT_ROUTE_ID':'e9-'+run_id,
    'HOST_ID_VALUE':base['HOST_ID_VALUE'],'HOST_JURISDICTION':'EU','JURISDICTION':'ES','SECTOR':'health-care',
    'SUBJECT_DID':examples['EXAMPLE_SUBJECT_DID'],
    'PROFESSIONAL_SMART_SUBJECT_DID':examples['EXAMPLE_SUBJECT_DID'],
    'SMART_SUBJECT_DID':examples['EXAMPLE_PROFESSIONAL_DID'],
    'PROFESSIONAL_ACTOR_DID':examples['EXAMPLE_PROFESSIONAL_DID'],
    'SMART_CLIENT_ID':examples['EXAMPLE_DEVICE_CLIENT_ID'],
    'PROFESSIONAL_CLIENT_ID':examples['EXAMPLE_DEVICE_CLIENT_ID'],
    'PROFESSIONAL_EMAIL':examples['EXAMPLE_EMAIL_PROFESSIONAL'],
    'PROFESSIONAL_ROLE':examples['EXAMPLE_HEALTHCARE_ACTOR_ROLE_GENERALIST_MEDICAL_PRACTITIONER'],
    'SMART_SUBJECT_OCCUPATION':examples['EXAMPLE_HEALTHCARE_ACTOR_ROLE_GENERALIST_MEDICAL_PRACTITIONER'],
    'PROFESSIONAL_SUBJECT_OCCUPATION':examples['EXAMPLE_HEALTHCARE_ACTOR_ROLE_GENERALIST_MEDICAL_PRACTITIONER'],
    'RUN_LIVE_GW_E2E':'1','RUN_LIVE_GW_E2E_ACTOR_CHAIN':'1',
    'RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION':'0','RUN_LIVE_GW_E2E_PROFILE_RUNTIME':'0',
    'RUN_LIVE_GW_E2E_IPS_INGESTION':'0','RUN_LIVE_GW_E2E_INDIVIDUAL_LIFECYCLE':'0',
    'LIVE_GW_ALLOW_HOST_TEARDOWN':'0','LIVE_GW_E2E_SUITE':'professional',
    'RUN_LIVE_PROFILE_RUNTIME_E2E':'1','RUN_LIVE_PROFILE_RUNTIME_PROFESSIONAL_E2E':'1',
}
base['HOST_JURISDICTION']='EU'
out=root/phase
out.mkdir(exist_ok=True)
(out/'configuration.json').write_text(json.dumps({'test_environment':test_env,'server_environment':{k:v for k,v in base.items() if k not in os.environ or os.environ[k]!=v}},indent=2)+'\n')
processes=[]
streams=[]

def start(name,cwd,command,url):
    stream=(out/(name+'.log')).open('wb')
    streams.append(stream)
    process=subprocess.Popen(command,cwd=cwd,env=base,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True)
    processes.append(process)
    for _ in range(90):
        if process.poll() is not None: raise RuntimeError(name+' exited; see '+str(out/(name+'.log')))
        try:
            with urllib.request.urlopen(url,timeout=1) as response:
                if response.status==200:return
        except Exception:time.sleep(0.5)
    raise RuntimeError(name+' readiness timeout')

status=1
try:
    source="import { PRIVATE_KEY_PEM } from './test/test-signing-key.fixture.ts'; process.env.ICA_VC_SIGNING_PRIVATE_KEY_PEM=PRIVATE_KEY_PEM; const {startIcaApiServer}=await import('./src/api/server.ts'); await startIcaApiServer();"
    start('ica',ica,['node','--input-type=module','-e',source],'http://127.0.0.1:33310/')
    start('gw',gw,['node','--env-file=.env.local-demo','--loader','ts-node/esm','--experimental-specifier-resolution=node','src/main.ts'],'http://127.0.0.1:33300/host/ping')
    for label,file in [(phase+'-prerequisite','live-gw-node-runtime.e2e.test.mjs'),(phase+'-individual','live-profile-runtime-individual.e2e.test.mjs'),(phase+'-professional','live-profile-runtime-professional.e2e.test.mjs')]:
        command=['python3',str(script_root/'run_gate.py'),'gdc-sdk-node-ts',label,'env',*[k+'='+v for k,v in test_env.items()],'node','--test','tests/'+file]
        result=subprocess.run(command)
        if result.returncode:sys.exit(result.returncode)
    status=0
finally:
    for process in reversed(processes):
        if process.poll() is None:
            os.killpg(process.pid,signal.SIGTERM)
            process.wait(timeout=15)
    for stream in streams:stream.close()
sys.exit(status)
