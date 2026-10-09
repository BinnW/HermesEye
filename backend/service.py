"""Application use cases. Durable intent precedes every execution request."""
import logging
import threading
import urllib.parse
from store import Fault, identifier

logger = logging.getLogger('hermeseye.service')


class Service:
    def __init__(self, store, hermes=None, enable_runs=False):
        self.store, self.hermes, self.enable_runs = store, hermes, enable_runs
        self.collectors = set()
        self.lock = threading.Lock()

    def capabilities(self):
        return dict(protocolVersion=1, serverId=self.store.server_id, workspaceId=self.store.workspace,
                    capabilities=dict(sync=True, sessions=self.hermes is not None, runs=self.hermes is not None and self.enable_runs,
                                      approvals=False, jobs=False, deployment=False, upstreamReplay=False))

    def submit(self, request):
        if self.hermes is None:
            raise Fault(503, 'hermes_not_configured')
        if request.get('kind') == 'run' and not self.enable_runs:
            raise Fault(403, 'runs_disabled')
        if not self.store.reserve(request):
            return self.store.operation(request['operationId'])
        oid, need = request['operationId'], request['needId']
        try:
            if request['kind'] == 'chat':
                binding = self.store.session(need)
                sid = binding['session']
                if not binding['ready']:
                    try:
                        self.hermes.request('/api/sessions', {'id': sid})
                    except Fault as error:
                        if error.code != 'upstream_http_409':
                            raise
                        self.hermes.request('/api/sessions/' + urllib.parse.quote(sid, safe=''))
                    self.store.bind_session(need, sid)
                response = self.hermes.request('/api/sessions/' + urllib.parse.quote(sid, safe='') + '/chat', {'message': request['input']})
                content = response.get('message', {}).get('content')
                if not isinstance(content, str) or not content or len(content) > 32000:
                    raise Fault(502, 'invalid_upstream_response')
                self.store.bind_session(need, identifier(response.get('session_id')))
                return self.store.finish(oid, 'completed', result={'message': content, 'sessionId': response['session_id']})
            response = self.hermes.request('/v1/runs', {'input': request['input']})
            run = identifier(response.get('run_id'))
            result = self.store.finish(oid, 'running', remote=run)
            self.collect(oid, run)
            return result
        except Exception as error:
            # 结果不确定必须留痕：记录操作号与异常类型，不记录上游 message（可能含私有数据）。
            logger.warning('执行结果不确定 operation=%s 错误类型=%s', oid, type(error).__name__)
            return self.store.finish(oid, 'unknown')

    def refresh(self, oid):
        operation = self.store.operation(oid)
        if not self.hermes or not operation['remoteId'] or operation['kind'] != 'run':
            return operation
        if operation['state'] in ('completed', 'failed', 'cancelled'):
            return operation
        try:
            response = self.hermes.request('/v1/runs/' + urllib.parse.quote(operation['remoteId'], safe=''))
            state = response.get('status')
            if state not in ('running', 'started', 'waiting_for_approval', 'stopping', 'completed', 'failed', 'cancelled'):
                raise Fault(502, 'invalid_run_status')
            result = self.store.finish(oid, state, result={'output': response.get('output', '')})
            if state not in ('completed', 'failed', 'cancelled'):
                self.collect(oid, operation['remoteId'])
            return result
        except Exception as error:
            # 观测失败不改写最后一次已知执行状态，但必须留下可检索的失败记录。
            logger.warning('查询执行状态失败 operation=%s 错误类型=%s', oid, type(error).__name__)
            return dict(operation, observation='unknown')

    def stop(self, oid):
        operation = self.store.operation(oid)
        if operation['kind'] != 'run' or not operation['remoteId'] or not self.hermes:
            raise Fault(409, 'operation_not_stoppable')
        if operation['state'] in ('completed', 'failed', 'cancelled'):
            return operation
        self.hermes.request('/v1/runs/' + urllib.parse.quote(operation['remoteId'], safe='') + '/stop', {})
        return self.store.finish(oid, 'stopping')

    def collect(self, oid, run):
        with self.lock:
            if oid in self.collectors:
                return
            self.collectors.add(oid)
        def work():
            terminal = False
            try:
                for event in self.hermes.events(run):
                    if not isinstance(event, dict) or event.get('run_id') != run:
                        raise ValueError('invalid event')
                    self.store.event(oid, {'type': 'upstream.event', 'payload': event})
                    terminal = event.get('event') in ('run.completed', 'run.failed', 'run.cancelled') or terminal
            except Exception as error:
                logger.warning('事件流中断 operation=%s 错误类型=%s', oid, type(error).__name__)
            finally:
                if not terminal:
                    self.store.event(oid, {'type': 'capture.gap', 'reason': 'stream_interrupted'})
                # Never reconnect this destructive event stream automatically.
        threading.Thread(target=work, daemon=True).start()
