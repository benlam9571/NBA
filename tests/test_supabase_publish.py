import importlib.util
import json
from datetime import datetime,timezone
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('publisher',ROOT/'deploy/publish_supabase.py');p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
NOW=datetime(2026,11,10,12,tzinfo=timezone.utc)
class FakeStorage:
 def __init__(self,fail=None):self.calls=[];self.fail=fail
 def upload(self,path,body,upsert=False):
  if self.fail and path.endswith(self.fail):raise p.PublishError('Storage upload failed')
  self.calls.append((path,json.loads(body),upsert))
def make_data(tmp):
 (tmp/'snapshot.json').write_text(json.dumps(dict(metadata={'latest_date':'2026-11-08'},teams=[{}]*30,games=[{'pid':'1'}],schedule=[])))
 (tmp/'odds.json').write_text(json.dumps(dict(schema_version=1,status='disconnected',rows=[])))
def test_manifest_published_last_and_objects_are_immutable(tmp_path):
 make_data(tmp_path);client=FakeStorage();manifest=p.publish(client,tmp_path,NOW)
 assert len(client.calls)==3 and client.calls[-1][0]=='latest.json'
 assert client.calls[-1][2] and not client.calls[0][2]
 assert manifest['snapshot'].endswith('/snapshot.json') and manifest['odds'].endswith('/odds.json')
 other=FakeStorage();p.publish(other,tmp_path,NOW);assert other.calls==client.calls

def test_partial_upload_never_switches_manifest(tmp_path):
 make_data(tmp_path);client=FakeStorage(fail='odds.json')
 with pytest.raises(p.PublishError):p.publish(client,tmp_path,NOW)
 assert len(client.calls)==1 and all(x[0]!='latest.json' for x in client.calls)

def test_test_fixtures_and_stale_data_never_uploaded(tmp_path):
 make_data(tmp_path);d=json.loads((tmp_path/'odds.json').read_text());d['is_fixture']=True;(tmp_path/'odds.json').write_text(json.dumps(d));c=FakeStorage()
 with pytest.raises(p.PublishError,match='test odds'):p.publish(c,tmp_path,NOW)
 assert not c.calls
 make_data(tmp_path);d=json.loads((tmp_path/'snapshot.json').read_text());d['metadata']['latest_date']='2025-01-01';(tmp_path/'snapshot.json').write_text(json.dumps(d))
 with pytest.raises(p.PublishError,match='stale'):p.publish(c,tmp_path,NOW)
 assert not c.calls

def test_project_origin_rejects_insecure_or_credential_urls():
 assert p.validate_url('https://project.supabase.co/')=='https://project.supabase.co'
 for url in ['http://x.test','https://user:secret@x.test','https://x.test/rest','https://x.test?q=1']:
  with pytest.raises(p.PublishError):p.validate_url(url)

def test_cache_control_headers_are_valid_http_values():
 # Storage serves this header back verbatim; bare numbers are invalid Cache-Control values.
 client=p.StorageClient('https://project.supabase.co','service-key');sent={}
 class Response:
  status=200
  def __enter__(self):return self
  def __exit__(self,*a):return False
 def fake_open(request,timeout):
  sent[request.full_url.rsplit('/',1)[-1]]=request.get_header('Cache-control');return Response()
 client.opener.open=fake_open
 client.upload('latest.json',b'{}',upsert=True)
 client.upload('versions/'+'a'*64+'/snapshot.json',b'{}')
 assert sent=={'latest.json':'no-cache','snapshot.json':'max-age=31536000, immutable'}
