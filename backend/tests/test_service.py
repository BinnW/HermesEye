import concurrent.futures
import io
import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from store import Store, Fault
from service import Service
from server import handler
from hermes import Hermes, NoRedirect
from reading import Reading


class FakeHermes:
    def __init__(self):
        self.calls = []
        self.fail = False
        self.content = 'reply'
        self.status = 'completed'
        self.conflict_once = False
    def request(self, path, body=None):
        self.calls.append((path, body))
        if self.fail:
            raise OSError('private token must not escape')
        if path == '/api/sessions' and self.conflict_once:
            self.conflict_once = False
            raise Fault(502, 'upstream_http_409')
        if path == '/v1/runs':
            return {'run_id': 'run1', 'status': 'started'}
        if path.endswith('/stop'):
            return {'status': 'stopping'}
        if path == '/v1/runs/run1':
            return {'status': self.status, 'output': 'done'}
        if path.endswith('/chat'):
            return {'session_id': 'rotated-session', 'message': {'content': self.content}}
        return {'session': {'id': body['id'] if body else 'session'}}
    def events(self, run):
        yield {'run_id': run, 'event': 'run.completed', 'output': 'done'}


class FakeResponse:
    def __init__(self, data=b'', lines=None):
        self.data = data
        self.lines = list(lines or [])
    def read(self, _size=-1):
        return self.data
    def readline(self, _size=-1):
        return self.lines.pop(0) if self.lines else b''
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False


class LineStream:
    def __init__(self, lines=None, chunk=None):
        self.lines = iter(lines or [])
        self.chunk = chunk
    def readline(self, _size=-1):
        return self.chunk if self.chunk is not None else next(self.lines, b'')
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False


class RawOpener:
    def __init__(self, response=None, error=None):
        self.response, self.error, self.requests = response, error, []
    def open(self, request, timeout=None):
        self.requests.append((request, timeout))
        if self.error:
            raise self.error
        return self.response


class BusinessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = self.tmp.name + '/db.sqlite'
        self.store = Store(self.path)
    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()
    def mutation(self, **changes):
        value = dict(deviceId='device1', mutationId='m1', kind='plan', id='p1', baseRevision=0,
                     deleted=False, payload={'title': 'Read', 'date': '2026-10-06', 'status': 'todo'})
        value.update(changes)
        return value
    def test_duplicate_mutation_survives_restart_and_changed_payload_is_rejected(self):
        first = self.store.mutate(self.mutation())
        sid = self.store.server_id
        self.store.close(); self.store = Store(self.path)
        self.assertEqual(first, self.store.mutate(self.mutation()))
        self.assertEqual(sid, self.store.server_id)
        self.assertEqual(1, self.store.snapshot()['cursor'])
        with self.assertRaises(Fault):
            self.store.mutate(self.mutation(payload={'title': 'different'}))
    def test_concurrent_clients_preserve_conflict_and_tombstone(self):
        self.store.mutate(self.mutation())
        a = self.mutation(mutationId='m2', baseRevision=1, deleted=True, payload={})
        b = self.mutation(deviceId='device2', mutationId='m3', baseRevision=1)
        with concurrent.futures.ThreadPoolExecutor() as pool:
            receipts = list(pool.map(self.store.mutate, [a, b]))
        self.assertEqual(['accepted', 'conflict'], sorted(r['status'] for r in receipts))
        winner = next(r for r in receipts if r['status'] == 'accepted')['entity']
        if not winner['deleted']:
            self.store.mutate(self.mutation(mutationId='m4', baseRevision=2, deleted=True, payload={}))
        self.assertTrue(self.store.snapshot()['entities'][0]['deleted'])
        self.assertEqual(receipts[1], self.store.mutate(b))
    def test_pagination_no_missing_changes_and_invalid_cursor(self):
        for i in range(5):
            self.store.mutate(self.mutation(id='p' + str(i), mutationId='m' + str(i)))
        cursor, entities = 0, []
        while True:
            page = self.store.sync(cursor, 2)
            entities.extend(page['entities']); cursor = page['cursor']
            if not page['hasMore']:
                break
        self.assertEqual(5, len(entities))
        with self.assertRaises(Fault):
            self.store.sync(99)
    def test_private_platform_fields_are_rejected(self):
        for field in ('token', 'calendarSource', 'reminderId', 'messages'):
            with self.assertRaises(Fault):
                self.store.mutate(self.mutation(payload={field: 'private'}))
    def test_chat_uses_native_session_and_persists_rotation(self):
        upstream = FakeHermes(); service = Service(self.store, upstream)
        request = dict(operationId='o1', needId='n1', kind='chat', input='hello')
        result = service.submit(request)
        self.assertEqual('completed', result['state'])
        self.assertEqual('rotated-session', self.store.session('n1')['session'])
        self.assertEqual(result, service.submit(request))
        self.assertEqual(2, len(upstream.calls))
        service.submit(dict(request, operationId='o2'))
        self.assertEqual('/api/sessions/rotated-session/chat', upstream.calls[-1][0])
        self.assertEqual({'message': 'hello'}, upstream.calls[-1][1])
    def test_failure_and_restart_never_reexecute_unknown_operation(self):
        upstream = FakeHermes(); upstream.fail = True
        service = Service(self.store, upstream)
        request = dict(operationId='o1', needId='n1', kind='chat', input='hello')
        self.assertEqual('unknown', service.submit(request)['state'])
        self.store.close(); self.store = Store(self.path)
        upstream.fail = False
        self.assertEqual('unknown', Service(self.store, upstream).submit(request)['state'])
        self.assertEqual(1, len(upstream.calls))
        with self.assertRaises(Fault):
            Service(self.store, upstream).submit(dict(request, operationId='o2'))
    def test_reserved_intent_becomes_unknown_on_restart(self):
        self.store.reserve(dict(operationId='o1', needId='n1', kind='run', input='x'))
        self.store.close(); self.store = Store(self.path)
        self.assertEqual('unknown', self.store.operation('o1')['state'])
        self.assertEqual('capture.gap', self.store.events('o1')[0]['event']['type'])
    def test_disabled_execution_does_not_reserve_an_operation(self):
        service = Service(self.store, FakeHermes())
        with self.assertRaises(Fault):
            service.submit(dict(operationId='o1', needId='n1', kind='run', input='x'))
        with self.assertRaises(Fault):
            self.store.operation('o1')
    def test_stop_is_stopping_not_cancelled_and_query_recovers(self):
        service = Service(self.store, FakeHermes(), True)
        request = dict(operationId='o1', needId='n1', kind='run', input='x')
        self.store.reserve(request); self.store.finish('o1', 'running', remote='run1')
        self.assertEqual('stopping', service.stop('o1')['state'])
        self.assertEqual('completed', service.refresh('o1')['state'])
    def test_workspace_reconfiguration_fails_closed(self):
        with self.assertRaises(Fault):
            Store(self.path, 'other')
    def test_upstream_roots_do_not_mix_endpoint_families(self):
        for root in ('http://example.com', 'https://example.com/v1', 'https://user:pass@example.com'):
            with self.assertRaises(ValueError):
                Hermes(root, 'token')
        self.assertEqual('https://example.com/proxy', Hermes('https://example.com/proxy/', 'token').root)
    def test_project_projection_preserves_structured_v1_fields_and_cas(self):
        payload = dict(name='Learn', goal='Understand', managedBy='agent', nextStep='Experiment',
            kind='learning', status='active', criteria='Explain the result', targetDate='2026-12-31',
            milestones=[dict(id='m1', title='Stage', dueDate='', done=False)],
            reviews=[dict(id='r1', text='Actual result', createdAt=1)])
        request = self.mutation(kind='project', payload=payload)
        receipt = self.store.mutate(request)
        self.assertEqual(payload, receipt['entity']['payload'])
        self.assertEqual('conflict', self.store.mutate(dict(request, mutationId='m2'))['status'])
        for field, value in [('kind', 'autonomous'), ('status', 'AI-completed'), ('targetDate', 'invalid'),
                             ('milestones', [{}]), ('milestones', [dict(id='m1', title='Stage', dueDate='', done='yes')]),
                             ('reviews', [dict(id='r1', text='Result', createdAt=0)]), ('token', 'private')]:
            with self.subTest(field=field), self.assertRaises(Fault):
                self.store.mutate(dict(request, mutationId='bad', payload=dict(payload, **{field: value})))

    def event_of(self, oid, kind, timeout=2.0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            found = [item for item in self.store.events(oid) if item['event'].get('type') == kind]
            if found:
                return found
            time.sleep(0.01)
        self.fail('等待事件超时: ' + kind)

    def test_store_rejects_unsupported_entity_and_invalid_mutation(self):
        with self.assertRaises(Fault): self.store.mutate(self.mutation(kind='unknown'))
        with self.assertRaises(Fault): self.store.mutate(self.mutation(baseRevision='0'))
        with self.assertRaises(Fault): self.store.mutate(self.mutation(deleted='yes'))
        with self.assertRaises(Fault): self.store.mutate(self.mutation(payload=[]))

    def test_store_business_value_and_plan_bounds(self):
        invalid = [
            dict(title='t', date='2026-10-06', status='todo', minutes=2000),
            dict(title='t', date='2026-10-06', status='todo', minutes=-1),
            dict(title='x' * 5000, date='2026-10-06', status='todo'),
            dict(title=5, date='2026-10-06', status='todo'),
            dict(title='', date='2026-10-06', status='todo'),
            dict(title='t', date='2026-10-06', status='bogus'),
            dict(title='t', date='bad-date', status='todo'),
        ]
        for payload in invalid:
            with self.subTest(payload=list(payload)), self.assertRaises(Fault):
                self.store.mutate(self.mutation(payload=payload))
        with self.assertRaises(Fault):
            self.store.mutate(self.mutation(kind='book', payload={'title': 't', 'progress': 101}))
        with self.assertRaises(Fault):
            self.store.mutate(self.mutation(kind='book', payload={'title': 't', 'progress': 'half'}))

    def test_store_mutation_id_reuse_and_sync_cursor_bounds(self):
        self.store.mutate(self.mutation())
        with self.assertRaises(Fault) as error:
            self.store.mutate(self.mutation(payload=dict(title='Other', date='2026-10-06', status='todo')))
        self.assertEqual('mutation_id_reused', error.exception.code)
        for cursor, limit in [('0', 100), (0, 0), (0, 201), (0, 'x')]:
            with self.subTest(cursor=cursor, limit=limit), self.assertRaises(Fault):
                self.store.sync(cursor, limit)

    def test_store_reserve_validation_and_id_reuse(self):
        with self.assertRaises(Fault):
            self.store.reserve(dict(operationId='o1', needId='n1', kind='bogus', input='x'))
        with self.assertRaises(Fault):
            self.store.reserve(dict(operationId='o1', needId='n1', kind='chat', input=' '))
        with self.assertRaises(Fault):
            self.store.reserve(dict(operationId='o1', needId='n1', kind='chat', input='x', extra=1))
        self.assertTrue(self.store.reserve(dict(operationId='o1', needId='n1', kind='chat', input='x')))
        with self.assertRaises(Fault) as error:
            self.store.reserve(dict(operationId='o1', needId='n2', kind='chat', input='different'))
        self.assertEqual('operation_id_reused', error.exception.code)

    def test_store_project_item_projection_bounds(self):
        base = dict(name='N', managedBy='agent', kind='learning', status='active')
        invalid = [
            'x',
            [dict(id='m1', title='S', dueDate='', done=False)] * 2,
            [dict(id='m1', title='', dueDate='', done=False)],
            [dict(id='m1', title='S', dueDate=5, done=False)],
            [dict(id='m1', title='S', dueDate='bad-date', done=False)],
        ]
        for value in invalid:
            with self.subTest(milestones=value), self.assertRaises(Fault):
                self.store.mutate(self.mutation(kind='project', payload=dict(base, milestones=value)))

    def test_submit_requires_hermes_and_rejects_invalid_upstream_content(self):
        with self.assertRaises(Fault) as error:
            Service(self.store).submit(dict(operationId='o1', needId='n1', kind='chat', input='x'))
        self.assertEqual('hermes_not_configured', error.exception.code)
        upstream = FakeHermes(); upstream.content = ''
        service = Service(self.store, upstream)
        self.assertEqual('unknown', service.submit(dict(operationId='o1', needId='n1', kind='chat', input='x'))['state'])
        self.assertEqual('unknown', self.store.operation('o1')['state'])

    def test_submit_rebinds_conflicting_native_session(self):
        upstream = FakeHermes(); upstream.conflict_once = True
        service = Service(self.store, upstream)
        self.assertEqual('completed', service.submit(dict(operationId='o1', needId='n1', kind='chat', input='hi'))['state'])
        self.assertEqual('/api/sessions', upstream.calls[0][0])
        self.assertTrue(upstream.calls[1][0].startswith('/api/sessions/'))
        self.assertTrue(upstream.calls[2][0].endswith('/chat'))
    def test_submit_propagates_non_conflict_session_fault(self):
        upstream = FakeHermes()
        def request(path, body=None):
            upstream.calls.append((path, body))
            if path == '/api/sessions':
                raise Fault(502, 'upstream_unavailable')
            return {'session': {'id': 's'}}
        upstream.request = request
        service = Service(self.store, upstream)
        self.assertEqual('unknown', service.submit(dict(operationId='o1', needId='n1', kind='chat', input='x'))['state'])
        self.assertEqual(['/api/sessions'], [call[0] for call in upstream.calls])

    def test_run_submission_collects_terminal_events_without_gap(self):
        service = Service(self.store, FakeHermes(), True)
        result = service.submit(dict(operationId='o1', needId='n1', kind='run', input='x'))
        self.assertEqual('running', result['state'])
        self.assertEqual('run1', result['remoteId'])
        events = self.event_of('o1', 'upstream.event')
        self.assertEqual('run.completed', events[0]['event']['payload']['event'])
        self.assertEqual([], [item for item in self.store.events('o1') if item['event'].get('type') == 'capture.gap'])

    def test_collector_skips_active_duplicate_and_records_interrupted_gap(self):
        service = Service(self.store, FakeHermes(), True)
        self.store.reserve(dict(operationId='o1', needId='n1', kind='run', input='x'))
        service.collectors.add('o1')
        service.collect('o1', 'run1')
        self.assertEqual([], self.store.events('o1'))
        service.collectors.clear()
        service.hermes.events = lambda run: iter([{'run_id': 'other', 'event': 'x'}])
        service.collect('o1', 'run1')
        gap = self.event_of('o1', 'capture.gap')
        self.assertEqual('stream_interrupted', gap[0]['event']['reason'])

    def test_stop_and_refresh_cover_non_run_and_terminal_paths(self):
        service = Service(self.store, FakeHermes(), True)
        self.store.reserve(dict(operationId='o1', needId='n1', kind='chat', input='x'))
        with self.assertRaises(Fault) as error:
            service.stop('o1')
        self.assertEqual('operation_not_stoppable', error.exception.code)
        request = dict(operationId='o2', needId='n2', kind='run', input='x')
        self.store.reserve(request); self.store.finish('o2', 'completed', remote='run1')
        self.assertEqual('completed', service.stop('o2')['state'])
        self.assertEqual('completed', service.refresh('o2')['state'])

    def test_refresh_reports_unknown_observation_for_invalid_status(self):
        upstream = FakeHermes(); upstream.status = 'bogus'
        service = Service(self.store, upstream, True)
        self.store.reserve(dict(operationId='o1', needId='n1', kind='run', input='x'))
        self.store.finish('o1', 'running', remote='run1')
        observed = service.refresh('o1')
        self.assertEqual('running', observed['state'])
        self.assertEqual('unknown', observed['observation'])

    def test_refresh_of_running_run_reconnects_collector(self):
        upstream = FakeHermes(); upstream.status = 'running'
        service = Service(self.store, upstream, True)
        self.store.reserve(dict(operationId='o1', needId='n1', kind='run', input='x'))
        self.store.finish('o1', 'running', remote='run1')
        self.assertEqual('running', service.refresh('o1')['state'])
        self.event_of('o1', 'upstream.event')

    def test_http_auth_sync_and_malformed_input(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(Service(self.store), 'test-credential'))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        root = 'http://127.0.0.1:' + str(server.server_port)
        def call(path, body=None, auth=True):
            headers = {'Authorization': 'Bearer test-credential'} if auth else {}
            req = urllib.request.Request(root + path, data=None if body is None else json.dumps(body).encode(), headers=headers)
            with urllib.request.urlopen(req, timeout=3) as response:
                return json.load(response)
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                call('/eye/v1/capabilities', auth=False)
            self.assertEqual(401, error.exception.code)
            error.exception.close()
            self.assertFalse(call('/eye/v1/capabilities')['capabilities']['sessions'])
            self.assertEqual('accepted', call('/eye/v1/mutations', self.mutation())['status'])
            self.assertEqual(1, call('/eye/v1/sync')['cursor'])
            with self.assertRaises(urllib.error.HTTPError) as error:
                call('/eye/v1/mutations', [])
            self.assertEqual(400, error.exception.code)
            error.exception.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()


class HermesAdapterTests(unittest.TestCase):
    def hermes(self):
        return Hermes('https://example.com', 'private-token')
    def test_redirect_handler_refuses_redirects(self):
        self.assertIsNone(NoRedirect().redirect_request(None, None, 302, '', None, 'https://example.com'))
    def test_transport_http_and_shape_errors_are_sanitized(self):
        hermes = self.hermes()
        failure = urllib.error.HTTPError('https://example.com/v1', 409, 'conflict', None, io.BytesIO(b''))
        hermes.opener = RawOpener(error=failure)
        with self.assertRaises(Fault) as error: hermes.request('/v1/x')
        self.assertEqual('upstream_http_409', error.exception.code)
        failure.close()
        hermes.opener = RawOpener(error=OSError('secret token'))
        with self.assertRaises(Fault) as error: hermes.request('/v1/x')
        self.assertEqual('upstream_unavailable', error.exception.code)
        self.assertNotIn('secret', str(error.exception))
        hermes.opener = RawOpener(response=FakeResponse(data=json.dumps({'ok': 1}).encode()))
        self.assertEqual({'ok': 1}, hermes.request('/v1/x'))
        for data in [b'not json', b'[1, 2]', b'\xff\xfe']:
            hermes.opener = RawOpener(response=FakeResponse(data=data))
            with self.assertRaises(Fault) as error: hermes.request('/v1/x')
            self.assertEqual('invalid_upstream_response', error.exception.code)
        hermes.opener = RawOpener(response=FakeResponse(data=b'x' * (1024 * 1024 + 1)))
        with self.assertRaises(Fault) as error: hermes.request('/v1/x')
        self.assertEqual('upstream_response_too_large', error.exception.code)
    def test_event_stream_parsing_and_limits(self):
        hermes = self.hermes()
        lines = [b'data: {"a": 1}\n', b'\n', b'data: [DONE]\n', b'\n', b'data: {"b": 2}\n', b'\n']
        hermes.opener = RawOpener(response=FakeResponse(lines=lines))
        self.assertEqual([{'a': 1}, {'b': 2}], list(hermes.events('run1')))
        hermes.opener = RawOpener(response=LineStream(lines=[b'x' * 65537, b'']))
        with self.assertRaises(Fault) as error: list(hermes.events('run1'))
        self.assertEqual('event_limit', error.exception.code)
        hermes.opener = RawOpener(response=LineStream(chunk=b'data: x\n'))
        with self.assertRaises(Fault) as error: list(hermes.events('run1'))
        self.assertEqual('event_limit', error.exception.code)


class ReadingSource:
    def fetch(self, book):
        return dict(id=book, title='Book ' + book, progress=1, progressUnit='percent', source='微信读书',
                    sourceUpdatedAt=None, entries=[dict(id='highlight-1', kind='highlight', text='note', location='1')])


class BrokenService:
    def capabilities(self):
        raise RuntimeError('boom')


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(self.tmp.name + '/db.sqlite')
        self.service = Service(self.store, FakeHermes(), True)
        self.reading = Reading(self.store, self.service, ReadingSource())
        self.service.reading = self.reading
        self.port = self.start(self.service)
    def start(self, service):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(service, 'credential'))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.server, self.thread = server, thread
        return server.server_port
    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()
        self.reading.stop(); self.store.close(); self.tmp.cleanup()
    def call(self, path, body=None, auth=True, raw=None):
        headers = {'Authorization': 'Bearer credential'} if auth else {}
        data = raw if raw is not None else (None if body is None else json.dumps(body).encode())
        request = urllib.request.Request('http://127.0.0.1:' + str(self.port) + path, data=data, headers=headers)
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.load(response)
    def status(self, path, **kwargs):
        try:
            self.call(path, **kwargs)
        except urllib.error.HTTPError as error:
            error.close()
            return error.code
        self.fail('请求应当失败: ' + path)
    def raw_status(self, request):
        connection = socket.create_connection(('127.0.0.1', self.port), timeout=3)
        try:
            connection.sendall(request)
            connection.shutdown(socket.SHUT_WR)
            data = b''
            while b'\r\n\r\n' not in data:
                chunk = connection.recv(65536)
                if not chunk:
                    break
                data += chunk
            return int(data.split(b' ')[1])
        finally:
            connection.close()
    def mutation(self):
        return dict(deviceId='device1', mutationId='m1', kind='plan', id='p1', baseRevision=0, deleted=False,
                    payload={'title': 'Read', 'date': '2026-10-06', 'status': 'todo'})
    def standalone(self, service):
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(service, 'credential'))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        return server, thread
    def test_reading_routes_cover_list_policy_collect_question_answer(self):
        self.assertFalse(self.call('/eye/v1/reading')['policy']['enabled'])
        self.call('/eye/v1/reading/policy', dict(enabled=False, bookIds=['b1'], intervalHours=24,
            timezone='Asia/Shanghai', consent=True))
        self.assertEqual(1, len(self.call('/eye/v1/reading/collect', {'cycleId': 'http1'})['books']))
        self.assertEqual('user', self.call('/eye/v1/reading/questions',
            dict(id='q1', bookId='b1', entryId='highlight-1', text='Why?'))['origin'])
        self.assertEqual('completed', self.call('/eye/v1/reading/answer',
            dict(questionId='q1', operationId='a1', input='Explain'))['state'])
    def test_reading_route_auth_invalid_body_and_unknown_path(self):
        self.assertEqual(401, self.status('/eye/v1/reading', auth=False))
        self.assertEqual(404, self.status('/eye/v1/reading/unknown'))
        self.assertEqual(400, self.status('/eye/v1/reading/collect', body={'bad': 'request'}))
        self.assertEqual(400, self.status('/eye/v1/reading/policy', body={'enabled': 'yes'}))
    def test_reading_route_reports_not_configured(self):
        server, thread = self.standalone(Service(self.store, FakeHermes()))
        try:
            request = urllib.request.Request('http://127.0.0.1:' + str(server.server_port) + '/eye/v1/reading',
                headers={'Authorization': 'Bearer credential'})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=3)
            self.assertEqual(503, error.exception.code); error.exception.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()
    def test_generic_routes_cover_snapshot_submit_refresh_events_and_stop(self):
        self.assertEqual(0, self.call('/eye/v1/snapshot')['cursor'])
        self.assertEqual('accepted', self.call('/eye/v1/mutations', self.mutation())['status'])
        self.assertEqual('completed', self.call('/eye/v1/operations',
            dict(operationId='o1', needId='n1', kind='chat', input='hi'))['state'])
        self.assertEqual('completed', self.call('/eye/v1/operations/o1')['state'])
        self.assertIn('events', self.call('/eye/v1/operations/o1/events'))
        self.assertEqual(400, self.status('/eye/v1/operations/o1/events?after=-1'))
        self.assertEqual('running', self.call('/eye/v1/operations',
            dict(operationId='o2', needId='n2', kind='run', input='x'))['state'])
        self.assertEqual('stopping', self.call('/eye/v1/operations/o2/stop', {})['state'])
        self.assertEqual(404, self.status('/eye/v1/operations/o1/bogus'))
        self.assertEqual(404, self.status('/eye/v1/nope'))
    def test_malformed_http_requests_are_rejected(self):
        self.assertEqual(413, self.status('/eye/v1/reading/policy', raw=b''))
        self.assertEqual(400, self.status('/eye/v1/reading/policy', raw=b'not-json'))
        self.assertEqual(400, self.raw_status(b'POST /eye/v1/reading HTTP/1.1\r\nHost: x\r\n' +
            b'Authorization: Bearer credential\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n'))
        self.assertEqual(413, self.raw_status(b'POST /eye/v1/reading HTTP/1.1\r\nHost: x\r\n' +
            b'Authorization: Bearer credential\r\nContent-Length: 200000\r\n\r\n'))
    def test_unhandled_exception_returns_internal_error(self):
        server, thread = self.standalone(BrokenService())
        try:
            request = urllib.request.Request('http://127.0.0.1:' + str(server.server_port) + '/eye/v1/capabilities',
                headers={'Authorization': 'Bearer credential'})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(request, timeout=3)
            self.assertEqual(500, error.exception.code); error.exception.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()
    def test_reply_tolerates_a_disconnected_client(self):
        instance = object.__new__(handler(BrokenService(), 'credential'))
        class Sink:
            def write(self, _data):
                raise BrokenPipeError()
        instance.wfile = Sink()
        instance.send_response = lambda _code: None
        instance.send_header = lambda *_args: None
        instance.end_headers = lambda: None
        instance.reply(200, {'ok': True})


if __name__ == '__main__':
    unittest.main()
