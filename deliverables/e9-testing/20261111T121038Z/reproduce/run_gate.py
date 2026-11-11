"""Capture exact commands, source state, runtime, output and exit status for E9."""
import datetime
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import time

script_root = pathlib.Path(__file__).resolve().parent
root = pathlib.Path(os.environ.get('E9_OUTPUT_ROOT', script_root))
workspace = pathlib.Path(os.environ.get('E9_WORKSPACE_ROOT', script_root.parent.parent))
repo, label, *command = sys.argv[1:]
cwd = pathlib.Path(os.environ.get('E9_WORKTREES_ROOT', workspace / '.codex-worktrees')) / ('e9-repair-' + repo)
node = subprocess.check_output(['node', '--version'], text=True).strip()
if node != 'v26.13.0':
    raise SystemExit('Unexpected Node runtime: ' + node)
meta = {
    'repository': repo, 'label': label, 'command': command,
    'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'node': node, 'npm': subprocess.check_output(['npm', '--version'], text=True).strip(),
    'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cwd, text=True).strip(),
    'working_tree': subprocess.check_output(['git', 'status', '--porcelain'], cwd=cwd, text=True),
}
meta['version'] = json.loads((cwd / 'package.json').read_text())['version']
meta['related_sources'] = {}
for name in ['gdc-common-utils-ts', 'gdc-sdk-core-ts', 'gdc-sdk-front-ts', 'gdc-sdk-node-ts', 'dataspace-ica-ts', 'ica-client-sdk-ts', 'gwtemplate-node-ts']:
    related = cwd.parent / ('e9-repair-' + name)
    meta['related_sources'][name] = {
        'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=related, text=True).strip(),
        'version': json.loads((related / 'package.json').read_text())['version'],
        'working_tree': subprocess.check_output(['git', 'status', '--porcelain'], cwd=related, text=True),
    }
for name in ['package.json', 'package-lock.json']:
    meta[name + '_sha256'] = hashlib.sha256((cwd / name).read_bytes()).hexdigest()
out = root / repo
out.mkdir(parents=True, exist_ok=True)
log = out / (label + '.log')
started = time.monotonic()
print(repo, label, 'START', flush=True)
with log.open('wb') as stream:
    result = subprocess.run(command, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT)
meta.update(exit_code=result.returncode, elapsed_seconds=round(time.monotonic() - started, 3),
            finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            log_sha256=hashlib.sha256(log.read_bytes()).hexdigest())
(out / (label + '.json')).write_text(json.dumps(meta, indent=2) + '\n')
print(json.dumps(meta), flush=True)
print(log.read_text(errors='replace')[-4500:], flush=True)
sys.exit(result.returncode)
