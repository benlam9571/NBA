"""Run exact specification acceptance against a source snapshot, cutting off Nov 7."""
import argparse
from pathlib import Path
import pandas as pd
from build_data import logs

def check(source):
 frames={s:pd.read_parquet(source/f'nba/player_box/parquet/player_box_{y}.parquet') for s,y in [('2025-26',2026),('2026-27',2027)]}
 for s in frames: frames[s]=frames[s].loc[pd.to_datetime(frames[s].game_date)<=pd.Timestamp('2026-11-07')]
 d=logs(frames);l=d[d.pid=='3945274'].sort_values(['date','game_id'],ascending=False)
 assert (len(d),sum(d.season=='2026-27'),d.pid.nunique())==(25097,3122,459)
 cur=l[l.season=='2026-27'];prev=l[l.season=='2025-26']
 assert (round(cur.pts.mean(),1),len(cur),l.head(5).pts.mean(),round(prev.pts.mean(),1),len(prev))==(40.1,9,43.4,33.0,65)
 assert (sum(l.head(10).pts>35.5),sum(l.head(5).pts>35.5),(prev.pts>35.5).mean())==(7,5,.4)
 for name,cols in dict(pra=['pts','reb','ast'],pr=['pts','reb'],pa=['pts','ast'],ra=['reb','ast'],stk=['stl','blk']).items():d[name]=d[cols].sum(axis=1)
 stats='pts reb ast fg3m pra pr pa ra stl blk stk tov'.split()
 grid=int((d.groupby('pid')[stats].max()+1).sum().sum());assert grid==83825,grid
 current=d[d.season=='2026-27'];counts=current.groupby('opp').game_id.nunique()
 for pos,expected in [('all',('CHI',129.6)),('G',('MIA',69.3))]:
  x=current if pos=='all' else current[current.pos==pos]
  values=x.groupby('opp').pts.sum()/counts
  assert (values.idxmax(),round(values.max(),1))==expected
 record=current.drop_duplicates(['game_id','team']);assert sum(record.wl=='W')==sum(record.wl=='L')
 sched=pd.read_parquet(source/'nba/schedules/parquet/nba_schedule_2027.parquet');sched=sched[(sched.season_type==2)&(pd.to_datetime(sched.game_date)>pd.Timestamp('2026-11-07'))&((sched.home_abbreviation=='LAL')|(sched.away_abbreviation=='LAL'))].sort_values('game_date_time')
 first=sched.iloc[0];assert str(first.game_date)=='2026-11-08' and first.home_abbreviation=='DET' and first.away_abbreviation=='LAL'
 print('PASS: all 14 specification acceptance checks (2026-11-07 cutoff)')
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);check(p.parse_args().source)
