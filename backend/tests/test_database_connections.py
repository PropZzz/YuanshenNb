import sqlite3

import pytest

from backend import database
from backend.repositories import create_user, init_db
from backend.repositories import common


@pytest.mark.parametrize("fail", [False, True])
def test_repository_closes_connections_and_rolls_back_failed_user_creation(tmp_path, monkeypatch, fail):
    path = tmp_path / "connection.sqlite3"
    init_db(path)
    if fail:
        with sqlite3.connect(path) as connection:
            connection.execute("CREATE TRIGGER reject_settings BEFORE INSERT ON settings "
                               "BEGIN SELECT RAISE(ABORT, 'settings rejected'); END")
    opened = []
    real_get_connection = common.get_connection

    def tracked_connection(*args, **kwargs):
        connection = real_get_connection(*args, **kwargs)
        opened.append(connection)
        return connection

    monkeypatch.setattr(common, "get_connection", tracked_connection)
    if fail:
        with pytest.raises(sqlite3.IntegrityError, match="settings rejected"):
            create_user(path, "connection@example.test", "Connection", "test-password")
    else:
        create_user(path, "connection@example.test", "Connection", "test-password")
    assert opened
    for connection in opened:
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            connection.execute("SELECT 1")
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == (0 if fail else 1)


def test_configuration_failure_closes_the_connection_before_reraising(tmp_path, monkeypatch):
    opened = []

    def rejected(connection):
        opened.append(connection)
        raise sqlite3.OperationalError("configuration rejected")

    monkeypatch.setattr(database, "_configure_connection", rejected)
    with pytest.raises(sqlite3.OperationalError, match="configuration rejected"):
        database.get_connection(tmp_path / "config.sqlite3")
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        opened[0].execute("SELECT 1")
