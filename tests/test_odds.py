from copy import deepcopy
from datetime import datetime, timezone, timedelta
import importlib.util
import json
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
import pytest
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('odds_fetch',ROOT/'odds/fetch.py')
o=importlib.util.module_from_spec(spec);spec.loader.exec_module(o)
NOW=datetime(2026,11,10,22,tzinfo=timezone.utc)
EVENT=dict(id='abc123',home_team='Los Angeles Lakers',away_team='Detroit Pistons',commence_time='2026-11-11T02:00:00Z')
SNAPSHOT=dict(games=[dict(pid='3945274',player='Luka Doncic'),dict(pid='1',player='Nikola Jokić')],teams=[dict(team='LAL',name='Los Angeles Lakers'),dict(team='DET',name='Detroit Pistons')],schedule=[dict(game_id='espn1',home='LAL',away='DET',tip='2026-11-11T02:00:00+00:00')])

def payload(outcomes=None):
 return EVENT|dict(bookmakers=[dict(key='sportsbet',title='Sportsbet',last_update='2026-11-10T21:50:00Z',markets=[dict(key='player_points',outcomes=outcomes or [dict(name='Over',description='Luka Dončić',point=35.5,price=1.95),dict(name='Under',description='Luka Dončić',point=35.5,price=1.85)])])])

def normalize(p,aliases=None,snapshot=None):
 s=snapshot or SNAPSHOT
 return o.normalize_event(EVENT,p,o.PlayerMatcher(s['games'],aliases or {}),s,NOW.isoformat())

def test_normalization_diacritics_suffixes_and_aliases():
 assert o.normalize_name('Nikola Jokić III')==o.normalize_name('Nikola Jokic')
 m=o.PlayerMatcher(SNAPSHOT['games'],{'Luka Magic':'3945274'})
 assert m.match('Luka Magic')==('3945274',None)
 assert m.match('Someone Else')==(None,'unmatched_player')
 assert o.PlayerMatcher([dict(pid='1',player='John Smith'),dict(pid='2',player='John Smith Jr.')],{}).match('John Smith')==(None,'ambiguous_player')
 with pytest.raises(o.OddsError):o.PlayerMatcher(SNAPSHOT['games'],{'Unknown':'99'})

def test_pairing_and_event_identity():
 rows,issues=normalize(payload());assert not issues
 r=rows[0];assert r['pid']=='3945274' and r['game_id']=='espn1' and r['eligible'] and r['over_price']==1.95 and r['line']==35.5
 with pytest.raises(o.OddsError,match='ID/schema'):normalize(payload()|{'id':'wrong'})
 with pytest.raises(o.OddsError,match='identity'):normalize(payload()|{'home_team':'Wrong'})

def test_never_pairs_different_lines_or_bookmakers():
 p=payload([dict(name='Over',description='Luka Doncic',point=35.5,price=1.9),dict(name='Under',description='Luka Doncic',point=34.5,price=1.9)])
 rows,issues=normalize(p);assert not rows and len(issues)==2
 p['bookmakers'].append(dict(key='tab',markets=[dict(key='player_points',outcomes=[dict(name='Under',description='Luka Doncic',point=35.5,price=1.9)])]))
 rows,issues=normalize(p);assert not rows and len(issues)==3

def test_unknown_players_and_integer_lines_are_visible_not_estimated():
 p=payload()
 for x in p['bookmakers'][0]['markets'][0]['outcomes']:x['point']=30
 rows,_=normalize(p);assert rows[0]['analysis_line']==30.5 and not rows[0]['eligible'] and rows[0]['reason']=='non_half_line'
 for x in p['bookmakers'][0]['markets'][0]['outcomes']:x['description']='No Match';x['point']=35.5
 rows,_=normalize(p);assert rows[0]['pid'] is None and rows[0]['reason']=='unmatched_player'
 s=deepcopy(SNAPSHOT);s['schedule']=[];rows,_=normalize(payload(),snapshot=s);assert rows[0]['reason']=='unmatched_event'

def test_invalid_and_duplicate_quotes():
 p=payload();p['bookmakers'][0]['markets'][0]['outcomes'][0]['price']=float('nan')
 rows,issues=normalize(p);assert not rows and any(i['reason']=='invalid_line_or_price' for i in issues)
 p=payload();p['bookmakers'][0]['markets'][0]['outcomes'].append(p['bookmakers'][0]['markets'][0]['outcomes'][0])
 with pytest.raises(o.OddsError,match='Duplicate'):normalize(p)

class FakeClient:
 def __init__(self,events=None,fail=False):self.used=0;self.remaining=100;self.calls=[];self.events=events if events is not None else [EVENT];self.fail=fail
 def get(self,path,params=None):
  self.calls.append((path,params))
  if path=='/events':return self.events
  if self.fail:raise o.OddsError('Network failure')
  self.used+=5;return payload()

def test_aest_day_pregame_selection_and_budget():
 c=FakeClient([EVENT,EVENT|dict(id='past',commence_time='2026-11-10T20:00:00Z'),EVENT|dict(id='tomorrow',commence_time='2026-11-12T02:00:00Z')])
 bundle=o.collect(SNAPSHOT,{},c,NOW,'2026-11-11');assert bundle['event_count']==1 and len(bundle['rows'])==1
 assert c.calls[1][1]['regions']=='au' and c.calls[1][1]['oddsFormat']=='decimal'
 c=FakeClient()
 with pytest.raises(o.OddsError,match='budget'):o.collect(SNAPSHOT,{},c,NOW,'2026-11-11',max_credits=4)
 assert len(c.calls)==1
 with pytest.raises(o.OddsError,match='Duplicate event'):o.collect(SNAPSHOT,{},FakeClient([EVENT,EVENT]),NOW,'2026-11-11')

def test_atomic_snapshots_and_history(tmp_path):
 output=tmp_path/'odds.json';history=tmp_path/'history'
 b=o.collect(SNAPSHOT,{},FakeClient(),NOW,'2026-11-11');o.publish(b,output,history,NOW)
 before=output.read_bytes()
 with pytest.raises(o.OddsError):o.collect(SNAPSHOT,{},FakeClient(fail=True),NOW,'2026-11-11')
 assert output.read_bytes()==before
 later=NOW+timedelta(minutes=10);b=o.collect(SNAPSHOT,{},FakeClient(),later,'2026-11-11');o.publish(b,output,history,later)
 saved=json.loads(output.read_text());assert len(saved['history'])==1 and len(saved['rows'])==1
 assert len(list(history.glob('*.json')))==2 and len(list(history.glob('*.csv')))==2
 assert list(history.glob('*.csv'))[0].read_text().splitlines()[0]==','.join(o.FIELDS)
 assert 'apiKey' not in output.read_text()

def test_credential_errors_never_expose_url_or_key():
 with pytest.raises(o.OddsError,match='missing'):o.Client('')
 client=o.Client('SUPER-SECRET')
 class BadOpener:
  def open(self,*args,**kwargs):raise HTTPError('https://example?apiKey=SUPER-SECRET',401,'bad',{},None)
 client.opener=BadOpener()
 with pytest.raises(o.OddsError) as exc:client.get('/events')
 assert 'SUPER-SECRET' not in str(exc.value) and 'HTTP 401' in str(exc.value)
 with pytest.raises(o.OddsError):client.get('/events/../bad')

def test_no_games_is_valid_empty_connected_snapshot():
 b=o.collect(SNAPSHOT,{},FakeClient([]),NOW,'2026-11-11');assert b['status']=='connected' and b['event_count']==0 and not b['rows']
