"""Fetch The Odds API v4 pre-game AU player props and atomically publish snapshots."""
import argparse
from collections import defaultdict
import csv
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import re
import tempfile
import unicodedata
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import build_opener, HTTPRedirectHandler
from zoneinfo import ZoneInfo

BASE = 'https://api.the-odds-api.com/v4/sports/basketball_nba'
MARKETS = {'player_points': 'pts', 'player_rebounds': 'reb', 'player_assists': 'ast',
           'player_threes': 'fg3m', 'player_points_rebounds_assists': 'pra'}
BOOKMAKERS = {'sportsbet': 'Sportsbet', 'tab': 'TAB'}
FIELDS = 'fetched_at,game_id,bookmaker,player_name,market,line,over_price,under_price'.split(',')
AEST = ZoneInfo('Australia/Brisbane')


class OddsError(Exception):
    """Safe to log: never contains a request URL or credential."""


def timestamp(value):
    try:
        d = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if d.tzinfo is None:
            raise ValueError()
        return d.astimezone(timezone.utc)
    except (ValueError, TypeError):
        raise OddsError('Invalid timezone-aware timestamp') from None


def normalize_name(name):
    text = ''.join(c for c in unicodedata.normalize('NFKD', name) if not unicodedata.combining(c))
    words = re.sub(r'[^a-z0-9 ]', '', text.lower()).split()
    while words and words[-1] in {'jr', 'sr', 'ii', 'iii', 'iv'}:
        words.pop()
    return ''.join(words)


class PlayerMatcher:
    def __init__(self, games, aliases):
        self.by_name = defaultdict(set)
        self.ids = {str(g['pid']) for g in games}
        for g in games:
            self.by_name[normalize_name(g['player'])].add(str(g['pid']))
        self.aliases = {}
        if not isinstance(aliases, dict):
            raise OddsError("Aliases must be a name-to-ID object")
        for name, pid in aliases.items():
            if not isinstance(name, str):
                raise OddsError("Alias names must be text")
            key = normalize_name(name)
            if str(pid) not in self.ids:
                raise OddsError('Alias references an unknown player ID')
            if key in self.aliases and self.aliases[key] != str(pid):
                raise OddsError('Conflicting normalized aliases')
            self.aliases[key] = str(pid)

    def match(self, name):
        key = normalize_name(name)
        if key in self.aliases:
            return self.aliases[key], None
        candidates = self.by_name.get(key, set())
        if len(candidates) == 1:
            return next(iter(candidates)), None
        return None, 'ambiguous_player' if candidates else 'unmatched_player'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Client:
    def __init__(self, key, max_credits=100):
        if not key:
            raise OddsError('ODDS_API_KEY is missing; add it securely to your environment')
        self.key = key
        self.used = 0
        self.max_credits = max_credits
        self.remaining = None
        self.opener = build_opener(NoRedirect())  # inherited proxy and TLS trust

    def get(self, path, params=None):
        if not re.fullmatch(r'/events(?:/[A-Za-z0-9_-]+/odds)?', path):
            raise OddsError('Invalid API resource path')
        query = urlencode({'apiKey': self.key, **(params or {})})
        try:
            with self.opener.open(BASE + path + '?' + query, timeout=30) as response:
                data = json.load(response)
                last = int(response.headers.get('x-requests-last', 0))
                self.used += last
                remain = response.headers.get('x-requests-remaining')
                self.remaining = int(remain) if remain is not None else None
                return data
        except HTTPError as exc:
            reason = {401: 'API key rejected', 403: 'Access denied or quota unavailable',
                      422: 'Requested player markets unavailable', 429: 'Rate limit exceeded; retry later'}.get(exc.code, 'API request failed')
            raise OddsError(f'{reason} (HTTP {exc.code}); old snapshot retained') from None
        except (URLError, TimeoutError, OSError, ValueError):
            raise OddsError('Network, TLS or invalid JSON response; old snapshot retained') from None


def resolve_game(event, snapshot):
    """Map vendor event IDs to ESPN IDs only for unique exact team/date matches."""
    names = {t['name']: t['team'] for t in snapshot['teams']}
    names.update({'Los Angeles Clippers': 'LAC', 'LA Clippers': 'LAC'})
    home, away = names.get(event.get('home_team')), names.get(event.get('away_team'))
    if not home or not away:
        return None
    tip = timestamp(event['commence_time'])
    matches = [g for g in snapshot['schedule'] if g['home'] == home and g['away'] == away
               and abs((timestamp(g['tip']) - tip).total_seconds()) <= 6 * 3600]
    return str(matches[0]['game_id']) if len(matches) == 1 else None


def normalize_event(event, payload, matcher, snapshot, fetched_at):
    if not isinstance(payload, dict) or payload.get('id') != event['id']:
        raise OddsError('Event response ID/schema mismatch')
    for key in ('home_team', 'away_team', 'commence_time'):
        if payload.get(key) != event.get(key):
            raise OddsError('Event response identity changed during fetch')
    if not isinstance(payload.get('bookmakers'), list):
        raise OddsError('Malformed bookmakers response')
    game_id = resolve_game(event, snapshot)
    rows, issues = [], []
    for book in payload['bookmakers']:
        if book.get('key') not in BOOKMAKERS:
            continue
        for market in book.get('markets', []):
            if market.get('key') not in MARKETS:
                continue
            pairs = defaultdict(dict)
            for outcome in market.get('outcomes', []):
                side = str(outcome.get('name', '')).lower()
                name, point, price = outcome.get('description'), outcome.get('point'), outcome.get('price')
                if side not in {'over', 'under'} or not isinstance(name, str):
                    continue
                if (not isinstance(point, (float, int)) or not math.isfinite(point) or point < 0
                        or not isinstance(price, (float, int)) or not math.isfinite(price) or price <= 1):
                    issues.append({'event_id': event['id'], 'player_name': name, 'reason': 'invalid_line_or_price'})
                    continue
                key = (name, float(point))  # never pair different lines or bookmakers
                if side in pairs[key]:
                    raise OddsError('Duplicate bookmaker outcome; old snapshot retained')
                pairs[key][side] = price
            for (name, point), pair in pairs.items():
                if set(pair) != {'over', 'under'}:
                    issues.append({'event_id': event['id'], 'player_name': name, 'reason': 'missing_opposite_side'})
                    continue
                pid, issue = matcher.match(name)
                # Integer lines allow pushes: retain them visibly, exclude from EV.
                half = abs(point % 1 - .5) < 1e-9
                eligible = bool(pid and game_id and half)
                reason = issue or ('unmatched_event' if not game_id else None) or ('non_half_line' if not half else None)
                updated = market.get("last_update") or book.get("last_update") or fetched_at
                timestamp(updated)
                rows.append(dict(fetched_at=fetched_at, game_id=game_id, event_id=event['id'],
                                 commence_time=event['commence_time'], home=event['home_team'], away=event['away_team'],
                                 bookmaker=book['key'], bookmaker_title=BOOKMAKERS[book['key']],
                                 player_name=name, pid=pid, market=market['key'], stat=MARKETS[market['key']],
                                 line=point, analysis_line=max(.5, math.floor(point) + .5),
                                 over_price=pair['over'], under_price=pair['under'], eligible=eligible,
                                 reason=reason, updated_at=updated))
    return rows, issues


def read_json(path, fallback=None):
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        raise OddsError('Existing snapshot is unreadable; refusing to overwrite') from None


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as f:
        temp = Path(f.name)
        try:
            json.dump(data, f, ensure_ascii=False, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
        except BaseException:
            temp.unlink(missing_ok=True)
            raise
    try:
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def collect(snapshot, aliases, client, now, target, max_events=16, max_credits=100):
    matcher = PlayerMatcher(snapshot['games'], aliases)
    events = client.get('/events')
    if not isinstance(events, list):
        raise OddsError('Malformed events response')
    selected = []
    for event in events:
        if not isinstance(event, dict) or not all(event.get(k) for k in ('id', 'commence_time', 'home_team', 'away_team')):
            raise OddsError('Malformed event record')
        tip = timestamp(event['commence_time'])
        if tip > now and tip.astimezone(AEST).date().isoformat() == target:
            selected.append(event)
    selected.sort(key=lambda e: (e['commence_time'], e['id']))
    if len({e['id'] for e in selected}) != len(selected):
        raise OddsError('Duplicate event IDs')
    if len(selected) > max_events:
        raise OddsError('Event limit exceeded; no odds calls made')
    # Five markets x one region is the expected maximum per event.
    if len(selected) * len(MARKETS) > max_credits:
        raise OddsError('Credit budget too small for selected events; no odds calls made')
    fetched = now.isoformat()
    rows, issues = [], []
    for event in selected:
        expected = len(MARKETS)
        if client.used + expected > max_credits or (client.remaining is not None and client.remaining < expected):
            raise OddsError('Credit budget/quota reached; old snapshot retained')
        payload = client.get('/events/' + event['id'] + '/odds',
                             {'regions': 'au', 'markets': ','.join(MARKETS), 'oddsFormat': 'decimal',
                              'bookmakers': ','.join(BOOKMAKERS)})
        paired, rejected = normalize_event(event, payload, matcher, snapshot, fetched)
        rows.extend(paired)
        issues.extend(rejected)
    return dict(schema_version=1, status='connected', fetched_at=fetched, target_date=target,
                event_count=len(selected), requests_used=client.used, requests_remaining=client.remaining,
                rows=rows, issues=issues)


def publish(bundle, output, history_dir, now):
    old = read_json(output, {})
    previous = old.get('history', []) + old.get('rows', [])
    cutoff = now - timedelta(days=30)
    dedup = {}
    for r in previous:
        if timestamp(r['fetched_at']) >= cutoff:
            key = tuple(r.get(k) for k in ('fetched_at', 'event_id', 'bookmaker', 'player_name', 'market', 'line'))
            dedup[key] = r
    # Do not truncate away latest valid prices; bound only historical series.
    bundle['history'] = sorted(dedup.values(), key=lambda r: r['fetched_at'])[-50000:]
    stamp = now.strftime('%Y%m%dT%H%M%S%fZ')
    atomic_json(history_dir / (stamp + '.json'), {k: v for k, v in bundle.items() if k != 'history'})
    history_dir.mkdir(parents=True, exist_ok=True)
    csv_path = history_dir / (stamp + '.csv')
    with csv_path.open('w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(bundle['rows'])
    atomic_json(output, bundle)  # last good public snapshot replaced only after full success


def main():
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=root/'data/snapshot.json')
    parser.add_argument('--output', type=Path, default=root/'data/odds.json')
    parser.add_argument('--aliases', type=Path, default=root/'odds/aliases.json')
    parser.add_argument('--history-dir', type=Path, default=root/'.cache/odds')
    parser.add_argument('--date', help='AEST YYYY-MM-DD (default: today)')
    parser.add_argument('--max-events', type=int, default=16)
    parser.add_argument('--max-credits', type=int, default=100)
    parser.add_argument('--force', action='store_true', help='Allow another paid fetch on this AEST date')
    args = parser.parse_args()
    now = datetime.now(timezone.utc)
    target = args.date or now.astimezone(AEST).date().isoformat()
    try:
        datetime.strptime(target, '%Y-%m-%d')
        if args.max_events < 1 or args.max_credits < 1:
            raise OddsError('Limits must be positive')
        old = read_json(args.output, {})
        if old.get('target_date') == target and not args.force:
            print('Already fetched for this AEST date; use --force for an additional paid refresh')
            return
        # Missing key is checked before any network calls. Never overwrite an existing snapshot.
        client = Client(os.environ.get('ODDS_API_KEY', ''), args.max_credits)
        snapshot = read_json(args.snapshot)
        if snapshot is None:
            raise OddsError('Run box-score ETL first')
        if (now.astimezone(ZoneInfo('America/New_York')).date() - datetime.fromisoformat(snapshot['metadata']['latest_date']).date()).days > 2:
            raise OddsError('Box-score snapshot is stale; refresh ETL first')
        bundle = collect(snapshot, read_json(args.aliases, {}), client, now, target, args.max_events, args.max_credits)
        publish(bundle, args.output, args.history_dir, now)
        print(json.dumps({k: bundle[k] for k in ('fetched_at', 'event_count', 'requests_used')} | {'quotes': len(bundle['rows']), 'issues': len(bundle['issues'])}))
    except (OddsError, ValueError, KeyError, TypeError, OSError) as exc:
        # Only our deliberately safe errors are printed; third-party exceptions can include URLs/keys.
        print(str(exc) if isinstance(exc, OddsError) else 'Invalid configuration or file operation; old snapshot retained')
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
