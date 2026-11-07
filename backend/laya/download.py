"""Explicit setup only. Downloads public weights, never sends conversations or tokens."""
from pathlib import Path
import os
ROOT = Path(__file__).resolve().parents[2]
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['HF_HOME'] = str(ROOT / '.local/laya-cache')
from huggingface_hub import snapshot_download
MODEL = 'convaiinnovations/laya-multilingual'
REVISION = '1720e3e3357cfe1e281542e223f8273b0890ca34'
path = snapshot_download(repo_id=MODEL, revision=REVISION, token=False,
    local_dir=ROOT / '.local/laya-model',
    allow_patterns=['rl_agent_config.json', 'model.safetensors', 'tokenizer/*', 'encoder/*', 'README.md'])
print('Laya multilingual checkpoint ready at .local/laya-model')
