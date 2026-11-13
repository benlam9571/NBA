"""Upload immutable private snapshots; switch the manifest only after both succeed."""
import argparse
from datetime import datetime, timezone, date
from zoneinfo import ZoneInfo
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

BUCKET='nba-props-private'
class PublishError(Exception):
    pass
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        return None


def validate_url(url):
    p=urlsplit(url)
    if p.scheme!='https' or not p.hostname or p.username or p.password or p.query or p.fragment or p.path not in ('','/'):
        raise PublishError('SUPABASE_URL must be an HTTPS project origin')
    return url.rstrip('/')


class StorageClient:
    def __init__(self,url,key):
        self.url=validate_url(url)
        if not key:raise PublishError('SUPABASE_SERVICE_ROLE_KEY is missing')
        self.key=key
        self.opener=build_opener(NoRedirect())
    def upload(self,path,body,upsert=False):
        if not (path=='latest.json' or re.fullmatch(r'versions/[a-f0-9]{64}/(snapshot|odds)\.json',path)):
            raise PublishError('Invalid storage object path')
        request=Request(self.url+'/storage/v1/object/'+BUCKET+'/'+path,data=body,method='POST',headers={
            'Authorization':'Bearer '+self.key,'apikey':self.key,'Content-Type':'application/json',
            'x-upsert':'true' if upsert else 'false','cache-control':'no-cache' if path=='latest.json' else 'max-age=31536000, immutable'})
        try:
            with self.opener.open(request,timeout=90) as response:
                if response.status not in (200,201):raise PublishError('Storage upload failed')
        except HTTPError as e:
            if e.code in (400,409) and not upsert:
                # A hash-addressed object may exist. Verify byte identity before reusing it.
                self.verify_existing(path,body)
                return
            raise PublishError(f'Storage upload failed (HTTP {e.code}); manifest retained') from None
        except (URLError,TimeoutError,OSError):
            raise PublishError('Storage connection/TLS failure; manifest retained') from None
    def verify_existing(self,path,expected):
        request=Request(self.url+'/storage/v1/object/authenticated/'+BUCKET+'/'+path,headers={'Authorization':'Bearer '+self.key,'apikey':self.key})
        try:
            with self.opener.open(request,timeout=90) as response:
                if response.read(len(expected)+1)!=expected:raise PublishError('Existing immutable object content differs; manifest retained')
        except (HTTPError,URLError,TimeoutError,OSError):
            raise PublishError('Cannot verify existing immutable object; manifest retained') from None


def publish(client,data_dir,now=None):
    try:
        raw=(data_dir/'snapshot.json').read_bytes()
        data=json.loads(raw)
        if not isinstance(data.get('games'),list) or not data['games'] or len(data.get('teams',[]))!=30 or not isinstance(data.get('schedule'),list):
            raise PublishError('Invalid or empty game snapshot; run ETL first')
        odds_raw=(data_dir/'odds.json').read_bytes() if (data_dir/'odds.json').exists() else b'{"schema_version":1,"status":"disconnected","rows":[],"history":[],"issues":[]}'
        odds=json.loads(odds_raw)
        if odds.get('schema_version')!=1 or odds.get('status') not in ('connected','disconnected') or not isinstance(odds.get('rows'),list):
            raise PublishError('Invalid odds snapshot')
        if odds.get('is_fixture'):raise PublishError('Refusing to upload test odds fixtures')
    except (OSError,ValueError,AttributeError):
        raise PublishError('Missing or invalid local data files; manifest retained') from None
    now=now or datetime.now(timezone.utc)
    try:
        latest=date.fromisoformat(data['metadata']['latest_date'])
    except (KeyError,TypeError,ValueError):
        raise PublishError('Missing snapshot data date; manifest retained') from None
    age=(now.astimezone(ZoneInfo('America/New_York')).date()-latest).days
    if age<0 or age>2:raise PublishError('Game snapshot is stale or future-dated; run ETL first')
    if max(len(raw),len(odds_raw))>52428800:raise PublishError('Snapshot exceeds private bucket file size limit')
    snapshot_hash=hashlib.sha256(raw).hexdigest()
    odds_hash=hashlib.sha256(odds_raw).hexdigest()
    snapshot_path=f'versions/{snapshot_hash}/snapshot.json'
    odds_path=f'versions/{odds_hash}/odds.json'
    client.upload(snapshot_path,raw)
    client.upload(odds_path,odds_raw)
    manifest=dict(schema_version=1,published_at=(now or datetime.now(timezone.utc)).isoformat(),snapshot=snapshot_path,odds=odds_path,latest_date=data['metadata']['latest_date'])
    client.upload('latest.json',json.dumps(manifest).encode(),upsert=True)
    return manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data',type=Path,default=Path(__file__).resolve().parents[1]/'data')
    parser.add_argument('--if-configured',action='store_true')
    a=parser.parse_args()
    url,key=os.environ.get('SUPABASE_URL'),os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url and not key and a.if_configured:
        print('Supabase publisher not configured; skipped without changing remote data')
        return
    try:
        if not url or not key:raise PublishError('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY securely before publishing')
        manifest=publish(StorageClient(url,key),a.data)
        print('Uploaded private snapshot version '+manifest['snapshot'].split('/')[1])
    except PublishError as e:
        print(str(e));raise SystemExit(1) from None
if __name__=='__main__':main()
