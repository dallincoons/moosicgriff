"""Create the scheduler's private database environment on the existing server."""
import os
from pathlib import Path
import re
import shutil

configuration = Path('config/yearly')
configuration.mkdir(parents=True, exist_ok=True)
if not (configuration / 'jobs.json').exists():
    shutil.copyfile('docker/yearly/jobs.json', configuration / 'jobs.json')

source = Path('/home/forge/music-release-rss/.env')
target = Path('.env')
if target.exists():
    raise SystemExit('Scheduler .env already exists; leaving it unchanged')
values = dict(line.split('=', 1) for line in source.read_text().splitlines()
              if line and not line.startswith('#'))
password = values['MOOSICGRAFF_DB_PASSWORD']
if not re.fullmatch(r'[0-9a-f]{64}', password):
    raise SystemExit('Unexpected primary database password format')
descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w') as handle:
    handle.write(f'YEARLY_DATABASE_URL=postgresql://moosicgraff_app:{password}@lookup-db:5432/moosicgraff\n')
print('Created private scheduler environment; no credentials printed')
