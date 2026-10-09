"""Single-process SQLite business boundary; no Hermes-owned database access."""
import hashlib
import json
import sqlite3
import threading
import time
import uuid


class Fault(Exception):
    def __init__(self, status, code, details=None):
        self.status, self.code, self.details = status, code, details
        super().__init__(code)


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def identifier(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 128 or not all(c.isalnum() or c in '-_.' for c in value):
        raise Fault(400, 'invalid_identifier')
    return value


class Store:
    def __init__(self, path, workspace='personal'):
        self.lock = threading.RLock()
        self.workspace = identifier(workspace)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
          CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS entities(kind TEXT, id TEXT, revision INTEGER, deleted INTEGER,
            payload TEXT, origin TEXT, PRIMARY KEY(kind,id));
          CREATE TABLE IF NOT EXISTS changes(seq INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS mutations(device TEXT, id TEXT, fingerprint TEXT, receipt TEXT,
            PRIMARY KEY(device,id));
          CREATE TABLE IF NOT EXISTS sessions(need TEXT PRIMARY KEY, session TEXT NOT NULL, ready INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, fingerprint TEXT, need TEXT, kind TEXT,
            state TEXT, remote TEXT, result TEXT, created REAL);
          CREATE TABLE IF NOT EXISTS events(operation TEXT, seq INTEGER, payload TEXT, PRIMARY KEY(operation,seq));
        ''')
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO meta VALUES (?,?)', ('serverId', str(uuid.uuid4())))
            self.db.execute('INSERT OR IGNORE INTO meta VALUES (?,?)', ('workspaceId', self.workspace))
        if self.db.execute('SELECT value FROM meta WHERE key="workspaceId"').fetchone()[0] != self.workspace:
            self.db.close()
            raise Fault(409, 'workspace_configuration_changed')
        self.server_id = self.db.execute('SELECT value FROM meta WHERE key="serverId"').fetchone()[0]
        # An intent written before a crash must never be executed again automatically.
        with self.db:
            self.db.execute("UPDATE operations SET state='unknown' WHERE state='submitting'")
            for row in self.db.execute("SELECT id FROM operations WHERE kind='run' AND state NOT IN ('completed','failed','cancelled')").fetchall():
                self._event(row['id'], {'type': 'capture.gap', 'reason': 'service_restart'})

    def close(self):
        self.db.close()

    @staticmethod
    def entity(row):
        return dict(kind=row['kind'], id=row['id'], revision=row['revision'], deleted=bool(row['deleted']),
                    payload=json.loads(row['payload']), origin=row['origin'])

    def mutate(self, request):
        device, mid = identifier(request.get('deviceId')), identifier(request.get('mutationId'))
        kind, eid = request.get('kind'), identifier(request.get('id'))
        if kind not in ('project', 'plan', 'record', 'book', 'need', 'link'):
            raise Fault(400, 'unsupported_entity')
        base = request.get('baseRevision')
        deleted, payload = request.get('deleted', False), request.get('payload')
        if type(base) is not int or base < 0 or type(deleted) is not bool or not isinstance(payload, dict):
            raise Fault(400, 'invalid_mutation')
        # Sync accepts an explicit business projection, never device reminders or credentials.
        fields = {
            'project': {'name', 'goal', 'managedBy', 'nextStep'},
            'plan': {'date', 'title', 'status', 'projectId', 'priority', 'minutes', 'note'},
            'record': {'title', 'content', 'date', 'projectId'},
            'book': {'title', 'author', 'source', 'progress'},
            'need': {'name', 'ownerKind', 'ownerId'},
            'link': {'sourceKind', 'sourceId', 'needId'}
        }
        if set(payload) - fields[kind] or len(encoded(payload).encode()) > 65536:
            raise Fault(400, 'invalid_business_projection')
        for key, value in payload.items():
            if key in ('minutes', 'progress'):
                if type(value) not in (int, float) or not 0 <= value <= (1440 if key == 'minutes' else 100):
                    raise Fault(400, 'invalid_business_value')
            elif not isinstance(value, str) or len(value) > 4000:
                raise Fault(400, 'invalid_business_value')
        if kind == 'plan' and not deleted:
            import datetime
            try:
                datetime.date.fromisoformat(payload.get('date', ''))
            except ValueError:
                raise Fault(400, 'invalid_plan_date') from None
            if not payload.get('title', '').strip() or payload.get('status') not in ('todo', 'doing', 'done'):
                raise Fault(400, 'invalid_plan')
        fingerprint = hashlib.sha256(encoded(request).encode()).hexdigest()
        with self.lock, self.db:
            prior = self.db.execute('SELECT * FROM mutations WHERE device=? AND id=?', (device, mid)).fetchone()
            if prior:
                if prior['fingerprint'] != fingerprint:
                    raise Fault(409, 'mutation_id_reused')
                return json.loads(prior['receipt'])
            current = self.db.execute('SELECT * FROM entities WHERE kind=? AND id=?', (kind, eid)).fetchone()
            if base != (current['revision'] if current else 0):
                # Conflict is a durable receipt too; resolution needs a new mutation ID.
                receipt = {'status': 'conflict', 'remote': self.entity(current) if current else None}
            else:
                entity = dict(kind=kind, id=eid, revision=base + 1, deleted=deleted, payload=payload, origin=device)
                self.db.execute('INSERT OR REPLACE INTO entities VALUES (?,?,?,?,?,?)',
                                (kind, eid, base + 1, int(deleted), encoded(payload), device))
                cursor = self.db.execute('INSERT INTO changes(entity) VALUES (?)', (encoded(entity),)).lastrowid
                receipt = {'status': 'accepted', 'entity': entity, 'cursor': cursor}
            self.db.execute('INSERT INTO mutations VALUES (?,?,?,?)', (device, mid, fingerprint, encoded(receipt)))
            return receipt

    def sync(self, cursor=0, limit=100):
        if type(cursor) is not int or cursor < 0 or type(limit) is not int or not 1 <= limit <= 200:
            raise Fault(400, 'invalid_cursor')
        with self.lock:
            boundary = self.db.execute('SELECT COALESCE(MAX(seq),0) FROM changes').fetchone()[0]
            if cursor > boundary:
                raise Fault(409, 'cursor_invalid')
            rows = self.db.execute('SELECT * FROM changes WHERE seq>? ORDER BY seq LIMIT ?', (cursor, limit)).fetchall()
            next_cursor = rows[-1]['seq'] if rows else cursor
            return dict(entities=[json.loads(row['entity']) for row in rows], cursor=next_cursor,
                        hasMore=next_cursor < boundary, boundary=boundary)

    def snapshot(self):
        with self.lock:
            return dict(entities=[self.entity(r) for r in self.db.execute('SELECT * FROM entities ORDER BY kind,id')],
                        cursor=self.db.execute('SELECT COALESCE(MAX(seq),0) FROM changes').fetchone()[0])

    def session(self, need):
        need = identifier(need)
        with self.lock, self.db:
            self.db.execute('INSERT OR IGNORE INTO sessions VALUES (?,?,0)', (need, 'eye_' + uuid.uuid4().hex))
            return dict(self.db.execute('SELECT * FROM sessions WHERE need=?', (need,)).fetchone())

    def bind_session(self, need, session):
        identifier(session)
        with self.lock, self.db:
            self.db.execute('UPDATE sessions SET session=?,ready=1 WHERE need=?', (session, need))

    def operation(self, oid):
        identifier(oid)
        with self.lock:
            row = self.db.execute('SELECT * FROM operations WHERE id=?', (oid,)).fetchone()
            if not row:
                raise Fault(404, 'operation_not_found')
            return dict(id=row['id'], needId=row['need'], kind=row['kind'], state=row['state'],
                        remoteId=row['remote'], result=json.loads(row['result']))

    def reserve(self, request):
        oid, need = identifier(request.get('operationId')), identifier(request.get('needId'))
        kind, text = request.get('kind'), request.get('input')
        if kind not in ('chat', 'run') or not isinstance(text, str) or not 1 <= len(text.strip()) <= 4000:
            raise Fault(400, 'invalid_operation')
        if set(request) - {'operationId', 'needId', 'kind', 'input'}:
            raise Fault(400, 'unsupported_operation_fields')
        fingerprint = hashlib.sha256(encoded(request).encode()).hexdigest()
        with self.lock, self.db:
            prior = self.db.execute('SELECT fingerprint FROM operations WHERE id=?', (oid,)).fetchone()
            if prior:
                if prior['fingerprint'] != fingerprint:
                    raise Fault(409, 'operation_id_reused')
                return False
            active = self.db.execute("SELECT id FROM operations WHERE need=? AND state NOT IN ('completed','failed','cancelled')", (need,)).fetchone()
            if active:
                raise Fault(409, 'need_has_unresolved_operation', {'operationId': active['id']})
            self.db.execute('INSERT INTO operations VALUES (?,?,?,?,?,?,?,?)',
                            (oid, fingerprint, need, kind, 'submitting', None, '{}', time.time()))
            return True

    def finish(self, oid, state, remote=None, result=None):
        with self.lock, self.db:
            self.db.execute('UPDATE operations SET state=?,remote=COALESCE(?,remote),result=? WHERE id=?',
                            (state, remote, encoded(result or {}), oid))
            self._event(oid, {'type': 'operation.status', 'state': state})
        return self.operation(oid)

    def _event(self, oid, payload):
        seq = self.db.execute('SELECT COALESCE(MAX(seq),0)+1 FROM events WHERE operation=?', (oid,)).fetchone()[0]
        self.db.execute('INSERT INTO events VALUES (?,?,?)', (oid, seq, encoded(payload)))

    def event(self, oid, payload):
        with self.lock, self.db:
            self._event(oid, payload)

    def events(self, oid, after=0):
        self.operation(oid)
        with self.lock:
            rows = self.db.execute('SELECT * FROM events WHERE operation=? AND seq>? ORDER BY seq LIMIT 200', (oid, after)).fetchall()
            return [{'sequence': r['seq'], 'event': json.loads(r['payload'])} for r in rows]
