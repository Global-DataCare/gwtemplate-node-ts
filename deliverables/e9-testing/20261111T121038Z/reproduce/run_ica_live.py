"""Run the existing real HTTP ICA client journey against an isolated local ICA."""
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request

script_root = Path(__file__).resolve().parent
root = Path(os.environ.get('E9_OUTPUT_ROOT', script_root))
workspace = Path(os.environ.get('E9_WORKSPACE_ROOT', script_root.parent.parent))
label = sys.argv[1] if len(sys.argv) > 1 else '09-real-http'
worktrees = Path(os.environ.get('E9_WORKTREES_ROOT', workspace / '.codex-worktrees'))
ica = worktrees / 'e9-repair-dataspace-ica-ts'
client = worktrees / 'e9-repair-ica-client-sdk-ts'
fixture = Path(os.environ.get('E9_FNMT_PDF', workspace / 'examples/prueba-TEST-A4-multisign-fnmt.pdf'))
port = 33310
with socket.socket() as probe:
    probe.bind(('127.0.0.1', port))
env = dict(os.environ, SECURITY_MODE='demo', DB_PROVIDER='mem', NETWORK_MODE='test',
           ICA_API_HOST='127.0.0.1', ICA_API_PORT=str(port), DID_WEB_DOMAIN='localhost:' + str(port),
           ICA_KNOWN_CERTS_AUTO_DOWNLOAD='true')
source = "import { PRIVATE_KEY_PEM } from './test/test-signing-key.fixture.ts'; process.env.ICA_VC_SIGNING_PRIVATE_KEY_PEM = PRIVATE_KEY_PEM; const { startIcaApiServer } = await import('./src/api/server.ts'); await startIcaApiServer();"
node = subprocess.check_output(['node', '--version'], text=True).strip()
assert node == 'v26.13.0', node
out = root / 'dataspace-ica-ts'
out.mkdir(exist_ok=True)
log = out / (label + '-server.log')
record = {'command': ['node', '--input-type=module', '-e', source], 'node': node,
          'environment': {k: env[k] for k in ['SECURITY_MODE','DB_PROVIDER','NETWORK_MODE','ICA_API_HOST','ICA_API_PORT','DID_WEB_DOMAIN','ICA_KNOWN_CERTS_AUTO_DOWNLOAD']},
          'signing': 'repository public test-signing-key.fixture.ts; not a production trust chain',
          'pdf_sha256': hashlib.sha256(fixture.read_bytes()).hexdigest()}
with log.open('wb') as stream:
    server = subprocess.Popen(record['command'], cwd=ica, env=env, stdout=stream, stderr=subprocess.STDOUT)
    try:
        ready = False
        for _ in range(60):
            if server.poll() is not None:
                raise RuntimeError('ICA exited before readiness; see ' + str(log))
            try:
                with urllib.request.urlopen('http://127.0.0.1:%s/' % port, timeout=1) as response:
                    ready = response.status == 200
                if ready:
                    break
            except Exception:
                time.sleep(0.5)
        if not ready:
            raise RuntimeError('ICA did not become ready')
        print('ICA ready with an explicit repository test signing key', flush=True)
        command = ['python3', str(script_root / 'run_gate.py'), 'ica-client-sdk-ts', label,
                   'env', 'ICA_LIVE_E2E=1', 'ICA_BASE_URL=http://127.0.0.1:%s' % port,
                   'ICA_LIVE_E2E_PDF_PATH=' + str(fixture), 'node', '--experimental-vm-modules',
                   'node_modules/jest/bin/jest.js', '--config', './jest.live.config.js',
                   '--runInBand', '--runTestsByPath', 'src/__tests__/IcaClient.live.test.ts']
        result = subprocess.run(command)
        record.update(ready=True, client_exit_code=result.returncode)
    finally:
        server.terminate()
        server.wait(timeout=15)
        record['server_stopped_by_harness'] = True
        record['log_sha256'] = hashlib.sha256(log.read_bytes()).hexdigest()
        (out / (label + '-server.json')).write_text(json.dumps(record, indent=2) + '\n')
sys.exit(result.returncode)
