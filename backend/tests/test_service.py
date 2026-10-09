import concurrent.futures
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from store import Store, Fault
from service import Service
from server import handler
from hermes import Hermes


class FakeHermes:
    def __init__(self):
        self.calls = []
        self.fail = False
    def request(self, path, body=None):
        self.calls.append((path, body))
        if self.fail:
            raise OSError('private token must not escape')
        if path == '/v1/runs':
            return {'run_id': 'run1', 'status': 'started'}
        if path.endswith('/stop'):
            return {'status': 'stopping'}
        if path == '/v1/runs/run1':
            return {'status': 'completed', 'output': 'done'}
        if path.endswith('/chat'):
            return {'session_id': 'rotated-session', 'message': {'content': 'reply'}}
        return {'session': {'id': body['id'] if body else 'session'}}
    def events(self, run):
        yield {'run_id': run, 'event': 'run.completed', 'output': 'done'}


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


if __name__ == '__main__':
    unittest.main()
