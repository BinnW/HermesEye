"""V1 reading: authorized scope, complete sources and non-replaying durable interactions."""
import copy
import hashlib
import io
import json
import os
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from reading import Reading, WeRead
from service import Service
from store import Store, Fault, encoded


class FakeOpener:
    def __init__(self, payload):
        self.payload = payload
    def open(self, *_args, **_kwargs):
        return io.BytesIO(self.payload)


class Source:
    def __init__(self):
        self.calls = []
        self.fail = ''
        self.text = 'original note'
        self.entries = True
    def fetch(self, book):
        self.calls.append(book)
        if self.fail == book:
            raise Fault(502, 'source_down')
        return dict(id=book, title='Book ' + book, progress=1, progressUnit='percent',
                    source='微信读书', sourceUpdatedAt=None,
                    entries=[dict(id='highlight-1', kind='highlight', text=self.text, location='1:2')] if self.entries else [])


class Upstream:
    def __init__(self):
        self.calls = []
        self.fail = False
    def request(self, path, body=None):
        self.calls.append((path, body))
        if self.fail:
            raise OSError('private source must not appear in logs')
        if path == '/api/sessions':
            return {'session': {'id': body['id']}}
        return {'session_id': path.split('/')[3], 'message': {'content': 'organized answer'}}


class ReadingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = self.tmp.name + '/db'
        self.store = Store(self.path)
        self.source, self.hermes = Source(), Upstream()
        self.service = Service(self.store, self.hermes)
        self.reading = Reading(self.store, self.service, self.source)
        self.service.reading = self.reading
    def tearDown(self):
        self.reading.stop()
        self.store.close()
        self.tmp.cleanup()
    def policy(self, **patches):
        return dict(dict(enabled=False, bookIds=['b1'], intervalHours=24, timezone='Asia/Shanghai', consent=True), **patches)
    def collect(self):
        self.reading.configure(self.policy())
        return self.reading.cycle('cycle1')['books'][0]
    def question(self, qid='q1', text='Why?'):
        return self.reading.question(dict(id=qid, bookId='b1', entryId='highlight-1', text=text))
    def test_default_disabled_and_unconsented_never_fetches(self):
        self.assertFalse(self.reading.policy()['enabled'])
        self.reading.tick(1e12)
        self.assertEqual([], self.source.calls)
        with self.assertRaises(Fault):
            self.reading.cycle('c1')
    def test_collection_idempotency_and_failure_are_durable_without_recollecting(self):
        self.collect(); calls = len(self.source.calls)
        self.reading.cycle('cycle1'); self.assertEqual(calls, len(self.source.calls))
        self.assertEqual('collected', self.reading.list()['collections'][0]['state'])
        self.source.fail = 'b1'
        with self.assertRaises(Fault): self.reading.cycle('bad-source')
        collection = self.reading.list()['collections'][0]
        self.assertEqual('failed', collection['state']); self.assertEqual('source_down', collection['error'])
        self.source.fail = ''; calls = len(self.source.calls)
        self.reading.cycle('bad-source'); self.assertEqual(calls, len(self.source.calls))
        with self.store.lock, self.store.db:
            self.store.db.execute("INSERT INTO reading_collections VALUES ('interrupted','collecting','',1)")
        self.reading = Reading(self.store, self.service, self.source)
        self.assertIn('unknown', [c['state'] for c in self.reading.list()['collections']])

    def test_scope_and_policy_validation(self):
        for change in [dict(enabled='yes'), dict(consent=1), dict(bookIds='all'), dict(bookIds=[[]]),
                       dict(bookIds=['b1', 'b1']), dict(bookIds=['bad/id']), dict(intervalHours=0),
                       dict(intervalHours=721), dict(intervalHours=True), dict(timezone='invalid'), dict(extra='secret')]:
            with self.subTest(change=change), self.assertRaises(Fault):
                self.reading.configure(self.policy(**change))
        for change in [dict(bookIds=[]), dict(consent=False)]:
            with self.assertRaises(Fault):
                self.reading.configure(self.policy(enabled=True, **change))
        self.reading.source = None
        with self.assertRaises(Fault):
            self.reading.configure(self.policy(enabled=True))
    def test_one_percent_is_not_one_hundred_percent(self):
        book = self.collect()
        self.assertEqual(1, book['progress'])
        self.assertEqual('percent', book['progressUnit'])
        self.assertEqual('organized answer', book['organized'])
        self.assertEqual('completed', book['cycles'][0]['state'])
    def test_complete_batch_before_publish_and_failure_preserves_last_success(self):
        first = self.collect()
        self.reading.configure(self.policy(bookIds=['b1', 'b2']))
        self.source.text = 'new note'; self.source.fail = 'b2'
        with self.assertRaises(Fault):
            self.reading.cycle('c2')
        book = self.reading.list()['books'][0]
        self.assertEqual(first['entries'], book['entries'])
        self.assertEqual(first['updatedAt'], book['updatedAt'])
        self.assertEqual(first['organized'], book['organized'])
    def test_unchanged_batches_and_restart_never_repeat_completed_organization(self):
        self.collect(); before = len(self.hermes.calls)
        self.reading.cycle('new-client-id')
        self.assertEqual(before, len(self.hermes.calls))
        self.store.close(); self.store = Store(self.path)
        self.service = Service(self.store, self.hermes)
        self.reading = Reading(self.store, self.service, self.source)
        self.reading.cycle('restart')
        self.assertEqual(before, len(self.hermes.calls))
        self.assertEqual('organized answer', self.reading.list()['books'][0]['organized'])
    def test_unknown_batch_is_visible_and_never_replayed(self):
        self.collect(); old = self.reading.list()['books'][0]['organized']
        self.source.text = 'changed'; self.hermes.fail = True
        self.reading.cycle('changed')
        before = len(self.hermes.calls)
        self.hermes.fail = False; self.reading.cycle('again')
        self.assertEqual(before, len(self.hermes.calls))
        book = self.reading.list()['books'][0]
        self.assertEqual(old, book['organized'])
        self.assertIn('unknown', [c['state'] for c in book['cycles']])
    def test_large_notes_are_split_without_losing_characters_or_source_ids(self):
        self.source.text = 'long note ' * 1000
        book = self.collect()
        self.assertGreater(len(book['cycles']), 1)
        pieces = []
        for path, body in self.hermes.calls:
            if path.endswith('/chat'):
                self.assertLessEqual(len(body['message']), 4000)
                pieces.extend(json.loads(body['message'].split('\n', 1)[1]))
        self.assertEqual(self.source.text, ''.join(p['text'] for p in pieces))
        self.assertEqual({'highlight-1'}, {p['id'] for p in pieces})
        self.assertEqual(list(range(0, len(self.source.text), 500)), [p['offset'] for p in pieces])
    def test_all_current_parts_are_visible_even_above_thirty_and_other_books(self):
        original = self.source.fetch
        def many(book_id):
            book = original(book_id)
            book['entries'] = [dict(id='entry-' + str(i), kind='highlight', text='x' * 1500, location='1') for i in range(60)]
            return book
        self.source.fetch = many
        book = self.collect()
        self.assertGreater(len(book['cycles']), 30)
        self.assertTrue(all(c['state'] == 'completed' for c in book['cycles']))

    def test_no_notes_do_not_call_hermes_or_invent_progress(self):
        self.source.entries = False
        book = self.collect()
        self.assertEqual([], self.hermes.calls)
        self.assertEqual('', book['organized'])
    def test_question_idempotency_and_source_snapshot_survive_source_changes(self):
        self.collect(); first = self.question()
        self.assertEqual(first, self.question())
        with self.assertRaises(Fault):
            self.question(text='Different')
        self.source.text = 'changed note'; self.reading.cycle('c2')
        question = self.reading.list()['books'][0]['questions'][0]
        self.assertEqual('original note', question['sourceEntry']['text'])
        self.assertEqual('user', question['origin'])
        result = self.reading.answer(dict(questionId='q1', operationId='a1', input='Explain'))
        self.assertEqual('completed', result['state'])
        self.assertIn('original note', self.hermes.calls[-1][1]['message'])
        self.assertNotIn('changed note', self.hermes.calls[-1][1]['message'])
    def test_long_source_question_uses_explicit_quote_without_automatic_truncation(self):
        self.source.text = 'prefix ' + 'x' * 6000 + ' chosen source '
        self.collect()
        request = dict(id='q1', bookId='b1', entryId='highlight-1', text='Why?', quote='chosen source')
        question = self.reading.question(request)
        self.assertEqual('chosen source', question['sourceEntry']['text'])
        self.assertIn('offset=', question['sourceEntry']['location'])
        self.assertEqual('completed', self.reading.answer(dict(questionId='q1', operationId='a1', input='Explain'))['state'])
        for quote in ['', 'not in original', 'x' * 1501]:
            with self.assertRaises(Fault): self.reading.question(dict(request, id='q2', quote=quote))
        with self.assertRaises(Fault): self.reading.question(dict(request, quote='prefix'))

    def test_two_questions_have_distinct_durable_needs_and_no_cross_history(self):
        self.collect(); q1, q2 = self.question(), self.question('q2', 'Other?')
        self.assertNotEqual(q1['needId'], q2['needId'])
        for i in [1, 2]:
            self.reading.answer(dict(questionId='q' + str(i), operationId='a' + str(i), input='Explain'))
        questions = self.reading.list()['books'][0]['questions']
        self.assertEqual(['a1'], [o['id'] for o in questions[0]['interactions']])
        self.assertEqual(['a2'], [o['id'] for o in questions[1]['interactions']])
        self.assertNotEqual(self.store.session(q1['needId'])['session'], self.store.session(q2['needId'])['session'])
    def test_answer_timeout_duplicate_and_continue_blocked_until_resolved(self):
        self.collect(); self.question(); self.hermes.fail = True
        request = dict(questionId='q1', operationId='a1', input='Explain')
        self.assertEqual('unknown', self.reading.answer(request)['state'])
        before = len(self.hermes.calls); self.hermes.fail = False
        self.assertEqual('unknown', self.reading.answer(request)['state'])
        with self.assertRaises(Fault):
            self.reading.answer(dict(request, operationId='a2'))
        self.assertEqual(before, len(self.hermes.calls))
    def test_invalid_question_and_answer_does_not_execute(self):
        self.collect()
        for request in [dict(id='q1', bookId='absent', entryId='e1', text='Q'),
                        dict(id='q1', bookId='b1', entryId='absent', text='Q'),
                        dict(id='q1', bookId='b1', entryId='highlight-1', text=' '), {}]:
            with self.assertRaises(Fault): self.reading.question(request)
        self.question()
        for request in [{}, dict(questionId='absent', operationId='a1', input='X'),
                        dict(questionId='q1', operationId='a1', input=' '),
                        dict(questionId='q1', operationId='a1', input='x' * 1001)]:
            with self.assertRaises(Fault): self.reading.answer(request)
    def test_missing_source_items_are_retained_for_history(self):
        self.collect(); self.question(); self.source.entries = False
        book = self.reading.cycle('missing')['books'][0]
        self.assertEqual('original note', book['entries'][0]['text'])
        self.assertEqual('original note', book['questions'][0]['sourceEntry']['text'])
    def test_timer_advances_once_and_pausing_keeps_results(self):
        self.reading.configure(self.policy(enabled=True, intervalHours=1))
        now = self.reading.policy()['nextAt'] + 1
        self.reading.tick(now); calls = len(self.hermes.calls)
        self.reading.tick(now); self.assertEqual(calls, len(self.hermes.calls))
        self.reading.configure(self.policy(enabled=False))
        self.reading.tick(now + 100000)
        self.assertEqual(calls, len(self.hermes.calls))
        self.assertEqual(1, len(self.reading.list()['books']))
    def test_busy_cycle_does_not_overlap(self):
        self.reading.configure(self.policy()); self.reading.lock.acquire()
        try:
            with self.assertRaises(Fault): self.reading.cycle('c')
        finally: self.reading.lock.release()
        self.assertEqual([], self.source.calls)
    def test_pending_without_receipt_after_restart_is_unknown(self):
        self.collect()
        with self.store.lock, self.store.db:
            self.store.db.execute("UPDATE reading_cycles SET state='pending'")
            self.store.db.execute("UPDATE operations SET state='submitting'")
        self.store.close(); self.store = Store(self.path)
        self.reading = Reading(self.store, Service(self.store, self.hermes), self.source)
        self.assertEqual('unknown', self.reading.list()['books'][0]['cycles'][0]['state'])

    def test_configure_valid_scope_round_trips_and_rejects_oversized_scope(self):
        policy = self.reading.configure(self.policy(bookIds=['b1', 'b2'], intervalHours=1))
        self.assertEqual(1, policy['intervalHours'])
        self.assertEqual(['b1', 'b2'], self.reading.policy()['bookIds'])
        for change in [dict(bookIds=['b' + str(i) for i in range(31)]), dict(intervalHours='24'),
                       dict(intervalHours=720.0), dict(bookIds=[1])]:
            with self.subTest(change=change), self.assertRaises(Fault):
                self.reading.configure(self.policy(**change))
        self.service.hermes = None
        with self.assertRaises(Fault) as error:
            self.reading.configure(self.policy(enabled=True))
        self.assertEqual(409, error.exception.status)
    def test_list_backfills_pending_cycle_and_missing_operation_falls_back(self):
        self.collect()
        book = self.reading.list()['books'][0]
        fingerprint = hashlib.sha256(encoded(book['entries']).encode()).hexdigest()
        with self.store.lock, self.store.db:
            self.store.db.execute('INSERT INTO reading_cycles VALUES (?,?,?,?,?,?)',
                ('cyc-backfill', 'b1', fingerprint, 'missing-operation', 'pending', 999))
        cycles = {c['id']: c['state'] for c in self.reading.list()['books'][0]['cycles']}
        self.assertEqual('not_submitted', cycles['cyc-backfill'])
    def test_list_caps_collections_at_twenty_newest(self):
        with self.store.lock, self.store.db:
            for index in range(25):
                self.store.db.execute('INSERT INTO reading_collections VALUES (?,?,?,?)',
                    ('col' + str(index).zfill(2), 'collected', '', index))
        collections = self.reading.list()['collections']
        self.assertEqual(20, len(collections))
        self.assertEqual('col24', collections[0]['id'])
        self.assertNotIn('col00', [collection['id'] for collection in collections])
    def test_cycle_rejects_entries_duplicates_types_and_preview_limits(self):
        base = dict(title='Book b1', progress=1, progressUnit='percent', source='微信读书', sourceUpdatedAt=None)
        cases = [
            ('duplicate', [dict(id='x', kind='highlight', text='a', location='1'),
                           dict(id='x', kind='thought', text='b', location='2')], 'reading_entries_invalid'),
            ('too-many', [dict(id='e' + str(i), kind='highlight', text='a', location='1') for i in range(2001)],
             'reading_entries_invalid'),
            ('not-text', [dict(id='x', kind='highlight', text=5, location='1')], 'reading_entries_invalid'),
            ('text-too-long', [dict(id='x', kind='highlight', text='a' * 16001, location='1')], 'reading_entries_invalid'),
            ('too-large', [dict(id='e' + str(i), kind='highlight', text='a' * 14000, location='1') for i in range(40)],
             'reading_source_limit'),
        ]
        self.reading.configure(self.policy())
        for name, entries, code in cases:
            with self.subTest(name=name):
                self.source.fetch = lambda book_id, entries=entries: dict(base, id=book_id, entries=entries)
                with self.assertRaises(Fault) as error:
                    self.reading.cycle('cycle-' + name)
                self.assertEqual(code, error.exception.code)
                self.assertIsNone(self.store.db.execute('SELECT snapshot FROM reading_books').fetchone())
    def test_cycle_revoked_consent_fails_before_any_upstream_submission(self):
        def fetch(book_id):
            policy = self.reading.policy()
            policy['consent'] = False
            with self.store.lock, self.store.db:
                self.store.db.execute('UPDATE reading_policy SET policy=? WHERE id=1', (encoded(policy),))
            return dict(id=book_id, title='Book ' + book_id, progress=1, progressUnit='percent',
                        source='微信读书', sourceUpdatedAt=None,
                        entries=[dict(id='highlight-1', kind='highlight', text='note', location='1:2')])
        self.reading.configure(self.policy())
        self.source.fetch = fetch
        with self.assertRaises(Fault) as error:
            self.reading.cycle('revoked')
        self.assertEqual('reading_consent_revoked', error.exception.code)
        self.assertEqual([], [call for call in self.hermes.calls if call[0].endswith('/chat')])
        self.assertEqual('collected', self.reading.list()['collections'][0]['state'])
    def test_cycle_reuses_prior_cycle_and_never_replays_a_lost_operation(self):
        self.collect()
        with self.store.lock, self.store.db:
            self.store.db.execute('DELETE FROM operations')
        self.reading.cycle('after-delete')
        self.assertIn('not_submitted', [c['state'] for c in self.reading.list()['books'][0]['cycles']])
        self.source.text = 'changed again'
        with patch.object(self.service, 'submit', side_effect=Fault(502, 'submit_down')):
            self.reading.cycle('submit-fault')
        self.assertIn('not_submitted', [c['state'] for c in self.reading.list()['books'][0]['cycles']])
        self.assertEqual('organized answer', self.reading.list()['books'][0]['organized'])
    def test_cycle_reuses_completed_result_for_an_empty_prior_batch(self):
        self.source.entries = False
        self.collect()
        calls = len(self.hermes.calls)
        self.reading.cycle('empty-again')
        self.assertEqual(calls, len(self.hermes.calls))
        book = self.reading.list()['books'][0]
        self.assertEqual('', book['organized'])
        self.assertTrue(all(cycle['state'] == 'completed' for cycle in book['cycles']))
    def test_changed_fingerprint_creates_a_new_cycle(self):
        first = self.collect()
        self.source.text = 'changed note'
        second = self.reading.cycle('cycle2')['books'][0]
        self.assertNotEqual(first['cycles'][0]['id'], second['cycles'][0]['id'])
        self.assertEqual('organized answer', second['organized'])
    def test_failed_cycle_releases_the_lock(self):
        self.reading.configure(self.policy())
        self.source.fail = 'b1'
        with self.assertRaises(Fault):
            self.reading.cycle('lock-release')
        self.assertFalse(self.reading.lock.locked())
        self.source.fail = ''
        self.reading.cycle('lock-release-2')
        self.assertIn('collected', [c['state'] for c in self.reading.list()['collections']])
    def test_failed_scheduled_tick_is_logged_and_swallowed(self):
        self.reading.configure(self.policy(enabled=True, intervalHours=1))
        self.source.fail = 'b1'
        now = self.reading.policy()['nextAt'] + 1
        self.reading.tick(now)
        self.assertEqual('failed', self.reading.list()['collections'][0]['state'])
        self.assertGreater(self.reading.policy()['nextAt'], now)
    def test_worker_loop_ticks_once_and_stop_converges(self):
        ticks = []
        self.reading.tick = lambda now=None: ticks.append(now)
        self.reading.stop_event.wait = lambda timeout=None: len(ticks) > 0
        self.reading.start()
        self.reading.worker.join(2)
        self.assertFalse(self.reading.worker.is_alive())
        self.assertEqual(1, len(ticks))
        self.reading.stop()
    def test_start_twice_still_stops_every_started_worker(self):
        self.reading.start()
        first = self.reading.worker
        self.reading.start()
        second = self.reading.worker
        self.reading.stop()
        first.join(2); second.join(2)
        self.assertFalse(first.is_alive()); self.assertFalse(second.is_alive())
    def test_question_and_answer_context_limit_is_explicit(self):
        self.source.text = 'a' * 3000
        self.collect()
        self.question()
        with self.assertRaises(Fault) as error:
            self.reading.answer(dict(questionId='q1', operationId='a1', input='b' * 1000))
        self.assertEqual('reading_context_limit', error.exception.code)
    def test_parts_preserve_source_ids_offsets_and_reject_oversized_metadata(self):
        parts = self.reading.parts([dict(id='e1', kind='highlight', text='x' * 1200, location='1')])
        pieces = [piece for batch in parts for piece in batch]
        self.assertEqual([0, 500, 1000], [piece['offset'] for piece in pieces])
        self.assertEqual('x' * 1200, ''.join(piece['text'] for piece in pieces))
        self.assertEqual({'e1'}, {piece['id'] for piece in pieces})
        with self.assertRaises(Fault) as error:
            self.reading.parts([dict(id='e1', kind='highlight', text='x', location='L' * 4000)])
        self.assertEqual('reading_metadata_limit', error.exception.code)


class ReadingHttpTests(unittest.TestCase):
    setUp = ReadingTests.setUp
    tearDown = ReadingTests.tearDown
    policy = ReadingTests.policy
    # Reuse the fixture, not the business behavior cases, for a real HTTP route test.
    def test_authenticated_reading_routes_and_stable_operation_query(self):
        from http.server import ThreadingHTTPServer
        import threading
        import urllib.request
        import urllib.error
        from server import handler
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler(self.service, 'credential'))
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        def call(path, data=None):
            req = urllib.request.Request('http://127.0.0.1:' + str(server.server_port) + '/eye/v1' + path,
                data=None if data is None else json.dumps(data).encode(), headers={'Authorization': 'Bearer credential'})
            with urllib.request.urlopen(req, timeout=3) as result: return json.load(result)
        try:
            self.assertFalse(call('/reading')['policy']['enabled'])
            call('/reading/policy', self.policy())
            self.assertEqual(1, len(call('/reading/collect', {'cycleId': 'http1'})['books']))
            question = call('/reading/questions', dict(id='q1', bookId='b1', entryId='highlight-1', text='Why?'))
            self.assertEqual('user', question['origin'])
            result = call('/reading/answer', dict(questionId='q1', operationId='a1', input='Explain'))
            self.assertEqual('completed', result['state'])
            self.assertEqual(result, call('/operations/a1'))
            self.assertEqual('a1', call('/reading')['books'][0]['questions'][0]['interactions'][0]['id'])
            with self.assertRaises(urllib.error.HTTPError) as error: call('/reading/collect', {'bad': 'request'})
            self.assertEqual(400, error.exception.code); error.exception.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()


class WeReadTests(unittest.TestCase):
    def source(self, pages):
        source = WeRead('private'); calls = []
        def call(api, **params):
            calls.append((api, params)); return copy.deepcopy(pages.pop(0))
        source.call = call
        return source, calls
    def test_real_shape_pagination_and_progress(self):
        source, calls = self.source([
            {'book': {'title': 'Book'}, 'updated': [{'type': 1, 'bookmarkId': 'm1', 'markText': 'Original', 'chapterUid': 3}]},
            {'reviews': [{'review': {'reviewId': 'r1', 'content': 'Thought'}}], 'hasMore': True, 'synckey': 7},
            {'reviews': [], 'hasMore': False}, {'book': {'progress': 1, 'updateTime': 123}}])
        book = source.fetch('b1')
        self.assertEqual(['highlight', 'thought'], [e['kind'] for e in book['entries']])
        self.assertEqual(1, book['progress']); self.assertEqual(123, book['sourceUpdatedAt'])
        self.assertEqual({'bookid': 'b1', 'synckey': 7, 'count': 100}, calls[2][1])
    def test_missing_progress_is_unknown(self):
        source, _ = self.source([{'book': {'title': 'B'}}, {}, {}])
        self.assertIsNone(source.fetch('b')['progress'])
    def test_cursor_stall_and_malformed_progress_fail(self):
        source, _ = self.source([{}, {'hasMore': True, 'synckey': 1}, {'hasMore': True, 'synckey': 1}])
        with self.assertRaises(Fault): source.fetch('b')
        for value in [-1, 101, 1.5, True]:
            source, _ = self.source([{'book': {'title': 'B'}}, {}, {'book': {'progress': value}}])
            with self.assertRaises(Fault): source.fetch('b')
    def test_upgrade_rejection_and_private_transport_errors_are_sanitized(self):
        for result in [{'upgrade_info': {'version': 'new'}}, {'errcode': 401}, []]:
            source = WeRead('private')
            source.opener.open = lambda *_args, **_kwargs: io.BytesIO(json.dumps(result).encode())
            with self.assertRaises(Fault): source.call('/api')
        source = WeRead('private')
        source.opener.open = lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError('secret'))
        with self.assertRaises(Fault) as error: source.call('/api')
        self.assertNotIn('secret', str(error.exception))
    def test_call_success_and_oversized_response_boundary(self):
        source = WeRead('private')
        source.opener = FakeOpener(json.dumps({'errcode': 0, 'data': 7}).encode())
        self.assertEqual(7, source.call('/api')['data'])
        source.opener = FakeOpener(b'x' * (1024 * 1024 + 1))
        with self.assertRaises(Fault) as error: source.call('/api')
        self.assertEqual('reading_source_limit', error.exception.code)
    def test_fetch_rejects_missing_fields_blank_title_and_invalid_timestamp(self):
        cases = [
            ([{'book': {'title': 'B'}, 'updated': [{'type': 1}]}, {'hasMore': False}, {}], 'reading_source_shape_invalid'),
            ([{'book': {'title': '   '}}, {'hasMore': False}, {}], 'reading_book_invalid'),
            ([{'book': {}}, {'hasMore': False}, {}], 'reading_book_invalid'),
            ([{'book': {'title': 'B'}}, {'hasMore': False}, {'book': {'updateTime': -1}}], 'reading_timestamp_invalid'),
            ([{'book': {'title': 'B'}}, {'hasMore': False}, {'book': {'updateTime': 'now'}}], 'reading_timestamp_invalid'),
        ]
        for pages, code in cases:
            with self.subTest(code=code):
                source, _ = self.source(pages)
                with self.assertRaises(Fault) as error: source.fetch('b')
                self.assertEqual(code, error.exception.code)
    def test_pagination_fails_after_hundred_pages_without_completion(self):
        counter = {'pages': 0}
        source = WeRead('private')
        def call(api, **params):
            if api == '/review/list/mine':
                counter['pages'] += 1
                return {'reviews': [], 'hasMore': True, 'synckey': counter['pages']}
            if api == '/book/bookmarklist':
                return {'book': {'title': 'B'}}
            return {'book': {}}
        source.call = call
        with self.assertRaises(Fault) as error: source.fetch('b')
        self.assertEqual('reading_page_limit', error.exception.code)
        self.assertEqual(100, counter['pages'])


if __name__ == '__main__':
    unittest.main()
