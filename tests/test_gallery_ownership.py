"""tests.test_gallery_ownership — la suppression en galerie est réservée au créateur.

Couvre : user_id enregistré à la publication, list_videos renvoie user_id,
delete lève PermissionError pour un tiers (et pour une publication sans
créateur identifiable), KeyError pour une vidéo inconnue, et le parcours
de suppression réussi côté Supabase (storage + lignes dépendantes).
"""

import os
import tempfile
from types import SimpleNamespace

import pytest

from core.storage.local_backend import LocalCommunityStore
from core.storage.supabase_backend import SupabaseCommunityStore


@pytest.fixture
def tmp_workdir(monkeypatch, tmp_path):
    from core.storage import local_backend as lb
    monkeypatch.setattr(lb, "get_working_dir", lambda: str(tmp_path))
    return str(tmp_path)


def _publish_local(store, user_id="owner-1"):
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
        f.write(b"fake-mp4-bytes")
        path = f.name
    try:
        return store.publish(
            task_id="task-x", author="Alice", prompt="Une jolie vidéo",
            duration=15.0, resolution="768x1152", video_path=path,
            user_id=user_id,
        )
    finally:
        os.remove(path)


def test_local_publish_stores_user_id_and_lists_it(tmp_workdir):
    store = LocalCommunityStore()
    res = _publish_local(store, user_id="owner-1")
    listed = store.list_videos(per_page=50)["videos"]
    assert any(v["id"] == res["video_id"] and v["user_id"] == "owner-1"
               for v in listed)


def test_local_delete_refused_for_other_user(tmp_workdir):
    store = LocalCommunityStore()
    vid = _publish_local(store, user_id="owner-1")["video_id"]
    with pytest.raises(PermissionError):
        store.delete(vid, user_id="intruder")
    assert store.get_meta(vid) is not None  # intacte


def test_local_delete_ok_for_owner(tmp_workdir):
    store = LocalCommunityStore()
    vid = _publish_local(store, user_id="owner-1")["video_id"]
    store.delete(vid, user_id="owner-1")
    assert store.get_meta(vid) is None


def test_local_delete_refused_when_owner_unknown(tmp_workdir):
    store = LocalCommunityStore()
    vid = _publish_local(store, user_id="")["video_id"]
    with pytest.raises(PermissionError):
        store.delete(vid, user_id="anyone")


def test_local_delete_unknown_video_raises_keyerror(tmp_workdir):
    store = LocalCommunityStore()
    with pytest.raises(KeyError):
        store.delete("missing", user_id="owner-1")


def test_supabase_delete_ownership_checks(monkeypatch):
    store = SupabaseCommunityStore()
    monkeypatch.setattr(store, "get_meta", lambda vid: {"user_id": "owner-1"})
    with pytest.raises(PermissionError):
        store.delete("v1", user_id="intruder")
    monkeypatch.setattr(store, "get_meta", lambda vid: None)
    with pytest.raises(KeyError):
        store.delete("v1", user_id="owner-1")
    monkeypatch.setattr(store, "get_meta", lambda vid: {"user_id": ""})
    with pytest.raises(PermissionError):
        store.delete("v1", user_id="owner-1")


def test_supabase_delete_owner_success(monkeypatch):
    calls = []
    store = SupabaseCommunityStore()
    monkeypatch.setattr(store, "get_meta", lambda vid: {
        "user_id": "owner-1", "storage_path": "videos/v1.mp4",
    })

    class FakeStorageRef:
        def remove(self, paths):
            calls.append(("storage-remove", paths))

    class FakeStorage:
        def from_(self, bucket):
            calls.append(("storage-from", bucket))
            return FakeStorageRef()

    class FakeTable:
        def __init__(self, name):
            self._name = name

        def delete(self):
            return self

        def eq(self, key, value):
            calls.append(("table-delete", self._name, key, value))
            return self

        def execute(self):
            calls.append(("execute", self._name))
            return SimpleNamespace(data=[])

    class FakeClient:
        def __init__(self):
            self.storage = FakeStorage()

        def table(self, name):
            return FakeTable(name)

    import core.storage.supabase_backend as sb
    monkeypatch.setattr(sb, "_get_client", lambda: FakeClient())

    store.delete("v1", user_id="owner-1")
    assert ("storage-remove", ["videos/v1.mp4"]) in calls
    assert ("table-delete", "community_comments", "video_id", "v1") in calls
    assert ("table-delete", "community_likes", "video_id", "v1") in calls
    assert ("table-delete", "community_videos", "id", "v1") in calls
