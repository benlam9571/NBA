"""Validated, atomic NBA data snapshots. Never replace the last good snapshot on failure."""
import argparse
import json
import os
from pathlib import Path
import tempfile
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import pandas as pd

CURRENT = '2026-27'
COLUMNS = 'season,date,game_id,pid,player,pos,team,opp,ha,wl,start,min,pts,reb,ast,fg3m,stl,blk,tov,fga,fg3a,fta'.split(',')
RENAME = dict(zip('athlete_id athlete_display_name athlete_position_abbreviation team_abbreviation opponent_team_abbreviation minutes points rebounds assists three_point_field_goals_made steals blocks turnovers field_goals_attempted three_point_field_goals_attempted free_throws_attempted'.split(), 'pid player pos team opp min pts reb ast fg3m stl blk tov fga fg3a fta'.split()))
DIVISIONS = [('東岸','大西洋','BOS BKN NY PHI TOR'),('東岸','中部','CHI CLE DET IND MIL'),('東岸','東南','ATL CHA MIA ORL WSH'),('西岸','西北','DEN MIN OKC POR UTAH'),('西岸','太平洋','GS LAC LAL PHX SAC'),('西岸','西南','DAL HOU MEM NO SA')]

def truth(s):
    return s.astype(str).str.lower().isin(['true','1','1.0'])

def logs(frames):
    chunks=[]
    for season, raw in frames.items():
        d=raw.loc[(pd.to_numeric(raw.season_type)==2) & ~truth(raw.did_not_play) & (pd.to_numeric(raw.minutes,errors='coerce').fillna(0)>0)].copy()
        d=d.rename(columns=RENAME)
        d['pid']=pd.to_numeric(d.pid).astype('int64').astype(str)
        d['game_id']=pd.to_numeric(d.game_id).astype('int64').astype(str)
        d['season']=season
        d['date']=pd.to_datetime(d.game_date).dt.strftime('%Y-%m-%d')
        d['ha']=d.home_away.map({'home':'H','away':'A'})
        d['wl']=truth(d.team_winner).map({True:'W',False:'L'})
        d['start']=truth(d.starter).astype(int)
        d['pos']=d.pos.astype(str).map(lambda p: 'C' if 'C' in p else 'F' if 'F' in p else 'G')
        for c in COLUMNS[11:]: d[c]=pd.to_numeric(d[c],errors='raise').fillna(0).astype(int)
        chunks.append(d[COLUMNS])
    all_games=pd.concat(chunks,ignore_index=True)
    active=set(all_games.loc[all_games.season==CURRENT,'pid'])
    return all_games.loc[all_games.pid.isin(active)].sort_values(['date','game_id','team','player']).reset_index(drop=True)

def schedule(raw,now):
    d=raw.loc[(pd.to_numeric(raw.season_type)==2)&~truth(raw.status_type_completed)].copy()
    tip=pd.to_datetime(d.game_date_time,utc=True)
    d=d.loc[(tip>=now)&(tip<=now+timedelta(days=60))].copy()
    d['tip']=pd.to_datetime(d.game_date_time,utc=True).dt.strftime('%Y-%m-%dT%H:%M:%SZ')  # UTC with Z: "+0000" (no colon) is not standard JS Date syntax
    d['date']=pd.to_datetime(d.game_date).dt.strftime('%Y-%m-%d')
    d['game_id']=pd.to_numeric(d.game_id).astype('int64').astype(str)
    return d.rename(columns={'home_abbreviation':'home','away_abbreviation':'away'})[['date','tip','game_id','home','away']].sort_values('tip')

def teams(raw):
    d=raw.sort_values('game_date').drop_duplicates('team_abbreviation',keep='last')
    by=d.set_index('team_abbreviation')
    rows=[]
    for conf,division,codes in DIVISIONS:
        for code in codes.split():
            r=by.loc[code]
            rows.append(dict(team=code,name=r.team_display_name,short=r.team_name,conference=conf,division=division,color='#'+str(r.team_color).lstrip('#'),alternate='#'+str(r.team_alternate_color).lstrip('#')))
    return pd.DataFrame(rows)

def validate(d,old,now,allow_stale=False):
    if list(d.columns)!=COLUMNS or d.empty: raise ValueError('Missing/empty game log schema')
    if d.duplicated(['game_id','pid']).any(): raise ValueError('Duplicate player/game')
    if d.loc[d.season==CURRENT].empty: raise ValueError('No current-season games')
    if old is not None and sum(d.season==CURRENT)<sum(old.season==CURRENT): raise ValueError('Current-season row count decreased')
    age=(now.astimezone(ZoneInfo("America/New_York")).date()-pd.Timestamp(d.date.max()).date()).days
    if not allow_stale and (age>2 or age<0): raise ValueError(f'Data freshness failed: {age} days')

def build(source,output,now,allow_stale=False):
    frames={s:pd.read_parquet(source/f'nba/player_box/parquet/player_box_{y}.parquet') for s,y in [('2025-26',2026),(CURRENT,2027)]}
    d=logs(frames)
    raw=pd.read_parquet(source/'nba/schedules/parquet/nba_schedule_2027.parquet')
    upcoming=schedule(raw,now)
    team=teams(pd.concat(frames.values()))
    output.mkdir(parents=True,exist_ok=True)
    old=pd.read_csv(output/'nba_gamelogs.csv',dtype={'pid':str,'game_id':str}) if (output/'nba_gamelogs.csv').exists() else None
    validate(d,old,now,allow_stale)
    if old is not None and d.to_csv(index=False)==old[COLUMNS].to_csv(index=False) and (output/'nba_schedule_upcoming.csv').exists() and upcoming.to_csv(index=False)==(output/'nba_schedule_upcoming.csv').read_text():
        print('No new data; retained existing snapshot');return
    with tempfile.TemporaryDirectory(dir=output) as temp:
        tmp=Path(temp)
        d.to_csv(tmp/'nba_gamelogs.csv',index=False)
        upcoming.to_csv(tmp/'nba_schedule_upcoming.csv',index=False)
        team.to_csv(tmp/'nba_teams.csv',index=False)
        meta=dict(latest_date=d.date.max(),generated_at=now.isoformat(),current_season=CURRENT,rows=len(d),players=d.pid.nunique(),historical=allow_stale)
        (tmp/'metadata.json').write_text(json.dumps(meta,ensure_ascii=False))
        # UI consumes a single atomic bundle, so concurrent refreshes cannot mix files.
        (tmp/'snapshot.json').write_text(json.dumps(dict(metadata=meta,games=d.to_dict('records'),schedule=upcoming.to_dict('records'),teams=team.to_dict('records')),ensure_ascii=False))
        for p in tmp.iterdir(): os.replace(p,output/p.name)
    print(json.dumps(meta))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--as-of');p.add_argument('--allow-stale',action='store_true');a=p.parse_args()
    now=pd.Timestamp(a.as_of or datetime.now(timezone.utc)).to_pydatetime()
    if now.tzinfo is None: now=now.replace(tzinfo=timezone.utc)
    build(a.source,a.output,now,a.allow_stale)
