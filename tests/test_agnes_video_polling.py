"""tests.test_agnes_video_polling — exercise the REAL AgnesVideoAPI._poll_task.

Covers the grace window for transient HTTP 400/404 ("video not found"),
immediate abort for content-policy refusals, timeout handling, and the
final wait_for_video URL extraction. No network is involved: requests.get
and the global rate limiter are monkeypatched.

NOTE: intentionally NOT under tests/mock_regression/ so the real class is
exercised instead of MockAgnesVideoAPI.
"""

import asyncio
import itertools

import pytest
import requests

from core.api import agnes_video as av

DEFAULT_POLL = {"status": "processing", "progress": 0}
COMPLETED = {"status": "completed", "progress": 100, "video_url": "http://cdn.example/video.mp4"}


class FakeResponse:
    def __init__(self, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text if text else ""

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(
                f"{self.status_code} Client Error", response=self
            )


def _http_error_response(status_code, text=""):
    return FakeResponse(status_code=status_code, text=text)


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    """Rate limiter no-op + collected errors swallowed (no real logging sink)."""

    class NoopLimiter:
        def acquire(self):
            pass

    monkeypatch.setattr(av, "get_rate_limiter", lambda: NoopLimiter())
    monkeypatch.setattr(av, "collect_error", lambda *a, **k: None)
    monkeypatch.setattr(av, "collect_error_from_exception", lambda *a, **k: None)


@pytest.fixture
def api():
    return av.AgnesVideoAPI(api_key="test-key", max_retries=1)


async def _run_poll(api, monkeypatch, responses, *, interval=0.01,
                    max_poll_duration=5, max_consecutive_failures=3,
                    progress_callback=None):
    """Drive _poll_task against a scripted sequence of responses.

    Once the script is exhausted, polls keep returning "processing" so the
    loop never hits a StopIteration.
    """
    it = itertools.chain(iter(responses), itertools.repeat(FakeResponse(payload=DEFAULT_POLL)))
    monkeypatch.setattr(av.requests, "get", lambda *a, **k: next(it))
    return await api._poll_task(
        "task_abcdef123456",
        interval=interval,
        max_poll_duration=max_poll_duration,
        max_consecutive_failures=max_consecutive_failures,
        progress_callback=progress_callback,
    )


async def test_poll_returns_completed(api, monkeypatch):
    result = await _run_poll(api, monkeypatch, [FakeResponse(payload=COMPLETED)])
    assert result["status"] == "completed"
    assert result["video_url"] == COMPLETED["video_url"]


async def test_poll_forwards_progress_to_callback(api, monkeypatch):
    seen = []

    async def cb(status, progress, curl_cmd):
        seen.append((status, progress))

    await _run_poll(
        api, monkeypatch,
        [
            FakeResponse(payload={"status": "queued", "progress": 0}),
            FakeResponse(payload=COMPLETED),
        ],
        progress_callback=cb,
    )
    assert ("queued", 0) in seen
    assert ("completed", 100) in seen


async def test_poll_failed_status_raises(api, monkeypatch):
    with pytest.raises(RuntimeError, match="Video generation failed"):
        await _run_poll(
            api, monkeypatch,
            [FakeResponse(payload={"status": "failed", "error": "boom"})],
        )


async def test_poll_api_error_object_raises_immediately(api, monkeypatch):
    """HTTP 200 with {"error": ...} and no status → abort right away."""
    with pytest.raises(RuntimeError, match="API error: content_policy_violation"):
        await _run_poll(
            api, monkeypatch,
            [FakeResponse(payload={"error": {"code": "content_policy_violation", "message": "nope"}})] * 3,
            max_consecutive_failures=3,
        )


async def test_poll_content_policy_400_aborts_immediately(api, monkeypatch):
    """400 with content_policy text → immediate abort, no grace window."""
    bad = _http_error_response(400, text='{"error": "content_policy_violation"}')
    with pytest.raises(RuntimeError) as ei:
        await _run_poll(api, monkeypatch, [bad] * 10, max_consecutive_failures=10)
    msg = str(ei.value)
    assert "politique de contenu" in msg
    assert "un enfant qui joue dans un jardin" in msg


async def test_poll_transient_400_then_success(api, monkeypatch):
    """A couple of 400s inside the grace window must not kill the poll."""
    bad = _http_error_response(400, text="video not found or expired")
    result = await _run_poll(
        api, monkeypatch,
        [bad, bad, FakeResponse(payload=COMPLETED)],
        max_consecutive_failures=3,
    )
    assert result["status"] == "completed"


async def test_poll_persistent_400_aborts_with_actionable_message(api, monkeypatch):
    bad = _http_error_response(400, text="video not found or expired")
    with pytest.raises(RuntimeError) as ei:
        await _run_poll(api, monkeypatch, [bad] * 3, max_consecutive_failures=3)
    msg = str(ei.value)
    assert "introuvable ou expirée" in msg
    assert "Relancez la tâche" in msg


async def test_poll_http_500_then_success(api, monkeypatch):
    """Non-400 HTTP errors are also counted as ephemeral."""
    bad = _http_error_response(500, text="boom")
    result = await _run_poll(
        api, monkeypatch,
        [bad, FakeResponse(payload=COMPLETED)],
        max_consecutive_failures=3,
    )
    assert result["status"] == "completed"


async def test_poll_persistent_http_500_aborts(api, monkeypatch):
    bad = _http_error_response(500, text="boom")
    with pytest.raises(RuntimeError, match="Échec du polling après 3"):
        await _run_poll(api, monkeypatch, [bad] * 3, max_consecutive_failures=3)


async def test_poll_connection_error_aborts(api, monkeypatch):
    def boom(*a, **k):
        raise requests.exceptions.ConnectionError("connection refused")

    monkeypatch.setattr(av.requests, "get", boom)
    with pytest.raises(RuntimeError, match="Échec du polling après 3"):
        await api._poll_task(
            "task_abcdef123456",
            interval=0.01,
            max_poll_duration=5,
            max_consecutive_failures=3,
        )


async def test_poll_timeout_raises(api, monkeypatch):
    with pytest.raises(RuntimeError, match="Polling timed out"):
        await _run_poll(api, monkeypatch, [], max_poll_duration=0)


async def test_poll_respects_shutdown_event(api):
    import threading
    api.shutdown_event = threading.Event()
    api.shutdown_event.set()
    with pytest.raises(RuntimeError, match="cancelled by user"):
        await api._poll_task("task_abcdef123456", max_poll_duration=5)


async def test_wait_for_video_returns_url_output(api, monkeypatch):
    monkeypatch.setattr(av.requests, "get",
                        lambda *a, **k: FakeResponse(payload=COMPLETED))
    out = await api.wait_for_video("task_abcdef123456")
    assert out.fmt == "url"
    assert out.ext == "mp4"
    assert out.data == COMPLETED["video_url"]


async def test_wait_for_video_missing_url_raises(api, monkeypatch):
    monkeypatch.setattr(av.requests, "get",
                        lambda *a, **k: FakeResponse(payload={"status": "completed"}))
    with pytest.raises(RuntimeError, match="no URL in completed task"):
        await api.wait_for_video("task_abcdef123456")


async def _no_sleep(*a, **k):
    """Remplacer asyncio.sleep par un no-op (tests rapides)."""
    return None


async def test_poll_429_does_not_burn_grace_window(api, monkeypatch):
    """429 rate limit is NOT a lost video: pause then resume without counting
    against the consecutive-failure grace window."""
    monkeypatch.setattr(av.asyncio, "sleep", _no_sleep)  # no real waiting
    bad429 = _http_error_response(429, text="Too Many Requests")
    bad400 = _http_error_response(400, text="video not found or expired")
    result = await _run_poll(
        api, monkeypatch,
        [bad429, bad400, FakeResponse(payload=COMPLETED)],
        max_consecutive_failures=2,
    )
    assert result["status"] == "completed"


async def test_wait_for_video_auto_resubmit_when_video_lost(api, monkeypatch):
    """If the API loses the video during generation, wait_for_video resubmits
    once automatically instead of failing the task."""
    monkeypatch.setattr(av.asyncio, "sleep", _no_sleep)  # no real waiting
    api._last_payload = {"prompt": "un test", "num_frames": 73}
    api._last_mode_desc = "text-to-video"
    lost = _http_error_response(400, text="video not found or expired")

    submitted = []
    async def fake_submit(payload, mode_desc):
        submitted.append((payload, mode_desc))
        return "task_resubmitted_xyz"

    monkeypatch.setattr(api, "_submit_with_retry", fake_submit)
    # Éviter le HEAD request réel sur l'URL factice
    async def _fake_verify(url, timeout=10):
        return True
    monkeypatch.setattr(api, "_verify_video_url", _fake_verify)
    import itertools
    it = itertools.chain(iter([lost] * 15), itertools.repeat(FakeResponse(payload=COMPLETED)))
    monkeypatch.setattr(av.requests, "get", lambda *a, **k: next(it))

    out = await api.wait_for_video("task_lost_orig", max_poll_duration=5)
    assert out.data == COMPLETED["video_url"]
    assert submitted == [({"prompt": "un test", "num_frames": 73}, "text-to-video")]


async def test_wait_for_video_no_resubmit_without_payload(api, monkeypatch):
    """Without a stored payload (no prior submit), the error propagates."""
    monkeypatch.setattr(av.asyncio, "sleep", _no_sleep)
    bad = _http_error_response(400, text="video not found or expired")
    monkeypatch.setattr(av.requests, "get", lambda *a, **k: bad)
    with pytest.raises(RuntimeError, match="introuvable ou expirée"):
        await api.wait_for_video("task_lost_orig", max_poll_duration=5)
