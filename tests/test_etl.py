import sys
from pathlib import Path
from datetime import datetime, timezone
import pandas as pd
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'etl'))
from build_data import logs, schedule, validate, COLUMNS

def raw(pid=1,**kw):
 d=dict(athlete_id=float(pid),athlete_display_name='Player',athlete_position_abbreviation='G',team_abbreviation='LAL',opponent_team_abbreviation='DET',game_id=123,game_date='2026-11-07',home_away='home',team_winner=True,starter=False,season_type=2,did_not_play=False,minutes=30)
 for c in ['points','rebounds','assists','three_point_field_goals_made','steals','blocks','turnovers','field_goals_attempted','three_point_field_goals_attempted','free_throws_attempted']: d[c]=2
 return d|kw

def test_filters_and_active_roster():
 d=logs({'2025-26':pd.DataFrame([raw(1,game_id=99),raw(2)]),'2026-27':pd.DataFrame([raw(1),raw(2,did_not_play=True),raw(3,minutes=0),raw(4,minutes=None),raw(5,season_type=3),raw(6,season_type=5)])})
 assert list(d.columns)==COLUMNS
 assert len(d)==2 and set(d.pid)=={'1'}
 assert d.iloc[0].start==0 and d.iloc[0].ha=='H'

def test_schedule_filter_and_offset():
 d=pd.DataFrame([dict(season_type=2,status_type_completed=False,game_date='2026-11-08',game_date_time='2026-11-08T18:00:00-0500',game_id=1,home_abbreviation='DET',away_abbreviation='LAL'),dict(season_type=3,status_type_completed=False,game_date='2026-11-08',game_date_time='2026-11-08T18:00:00-0500',game_id=2,home_abbreviation='DET',away_abbreviation='LAL')])
 result=schedule(d,datetime(2026,11,8,tzinfo=timezone.utc))
 assert len(result)==1 and result.iloc[0].tip=='2026-11-08T23:00:00+0000'
 assert result.iloc[0].home=='DET'

def test_health_rejects_regression_and_staleness():
 d=logs({'2026-27':pd.DataFrame([raw()])})
 validate(d,None,datetime(2026,11,8,tzinfo=timezone.utc))
 with pytest.raises(ValueError,match='freshness'):validate(d,None,datetime(2026,11,11,tzinfo=timezone.utc))
 with pytest.raises(ValueError,match='decreased'):validate(d,pd.concat([d,d]),datetime(2026,11,8,tzinfo=timezone.utc))
