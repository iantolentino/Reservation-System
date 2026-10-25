#!/usr/bin/env python3
"""Small SQLite-backed server for the Assembly Room Scheduler MVP.

It deliberately uses only Python's standard library and SQLite so the project
has no external database dependency.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.server
import json
import mimetypes
import os
import secrets
import sqlite3
import time
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "data" / "assembly.db"
PORT = int(os.environ.get("PORT", "4173"))
SESSIONS: dict[str, dict[str, float | int]] = {}


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 180_000)
    return base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_text, digest_text = stored.split("$", 1)
        salt = base64.b64decode(salt_text)
        expected = base64.b64decode(digest_text)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 180_000)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize_database() -> None:
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              email TEXT NOT NULL UNIQUE COLLATE NOCASE,
              password_hash TEXT NOT NULL,
              role TEXT NOT NULL DEFAULT 'Admin',
              department TEXT NOT NULL DEFAULT 'Operations',
              status TEXT NOT NULL DEFAULT 'Active',
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rooms (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              type TEXT NOT NULL,
              location TEXT NOT NULL DEFAULT '',
              capacity INTEGER NOT NULL DEFAULT 1,
              equipment TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'Available',
              requires_approval INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reservations (
              id TEXT PRIMARY KEY,
              room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
              reserved_for TEXT NOT NULL,
              event_name TEXT NOT NULL DEFAULT '',
              requested_by TEXT NOT NULL,
              department TEXT NOT NULL DEFAULT '',
              date TEXT NOT NULL,
              start_date TEXT NOT NULL,
              end_date TEXT NOT NULL,
              start_time TEXT NOT NULL,
              end_time TEXT NOT NULL,
              time_type TEXT NOT NULL DEFAULT 'range',
              attendees INTEGER NOT NULL DEFAULT 0,
              equipment TEXT NOT NULL DEFAULT '',
              remarks TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'Pending',
              assignment_status TEXT NOT NULL DEFAULT 'Assigned',
              rejection_reason TEXT NOT NULL DEFAULT '',
              auto_unassigned_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
              setting_key TEXT PRIMARY KEY,
              setting_value TEXT NOT NULL
            );
            """
        )
        seed_database(db)


def seed_database(db: sqlite3.Connection) -> None:
    timestamp = now_iso()
    superadmin = db.execute("SELECT id FROM users WHERE email = ?", ("superadmin@stratastaff.com",)).fetchone()
    if not superadmin:
        legacy = db.execute("SELECT id FROM users WHERE email = ?", ("admin@assembly.local",)).fetchone()
        password_hash = "N538+6KBU8BbDiW60g+JAA==$CrYf50BgfeqGqdN+1tR2PffD/JKx3wAHpjD3KASlqRw="
        if legacy:
            db.execute(
                "UPDATE users SET name=?,email=?,password_hash=?,role=?,department=?,status='Active',updated_at=? WHERE id=?",
                ("Strata Staff Super Admin", "superadmin@stratastaff.com", password_hash, "Super Admin", "Administration", timestamp, legacy["id"]),
            )
        else:
            db.execute(
                "INSERT INTO users (name,email,password_hash,role,department,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                ("Strata Staff Super Admin", "superadmin@stratastaff.com", password_hash, "Super Admin", "Administration", "Active", timestamp, timestamp),
            )

    if db.execute("SELECT COUNT(*) AS count FROM rooms").fetchone()["count"] == 0:
        rooms = [
            ("room-m6a-training", "M6A Training Room", "Training Room", "M6A", 30, "Projector, TV, Whiteboard", "Available", 1),
            ("room-m6b-lounge", "M6B Client Lounge", "Lounge", "M6B", 18, "Coffee station, Display", "Available", 0),
            ("room-m6b-meeting", "M6B Meeting Room", "Meeting Room", "M6B", 12, "Display, Whiteboard", "Available", 0),
            ("room-m5b-conference", "M5B Conference Room", "Conference Room", "M5B", 16, "Projector, Conference phone", "Available", 0),
            ("room-m4a-workshop", "M4A Workshop Room", "Workshop Room", "M4A", 24, "Projector, Tables, Whiteboard", "Available", 1),
        ]
        db.executemany(
            "INSERT INTO rooms (id,name,type,location,capacity,equipment,status,requires_approval,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
            [room + (timestamp, timestamp) for room in rooms],
        )

    if db.execute("SELECT COUNT(*) AS count FROM reservations").fetchone()["count"] == 0:
        date = "2026-08-25"
        reservations = [
            ("res-001", "room-m6a-training", "L&D", "Training", "Marisol Santos", "Learning & Development", date, date, date, "07:00", "16:00", "range", 25, "Projector", "Quarterly onboarding session", "Approved"),
            ("res-002", "room-m6a-training", "HRD", "E-Sports", "Daniel Cruz", "HRD", date, date, date, "16:00", "23:59", "onwards", 20, "TV", "", "Approved"),
            ("res-003", "room-m6b-lounge", "CNG VIPs", "Client visit", "Angela Lim", "CNG", date, date, date, "00:00", "23:59", "whole-day", 10, "Coffee station", "Whole-day guest access", "Approved"),
            ("res-004", "room-m6b-meeting", "HRD", "E-Sports", "Daniel Cruz", "HRD", date, date, date, "16:00", "23:59", "onwards", 10, "Display", "", "Approved"),
            ("res-005", "room-m5b-conference", "Ms. Pat", "Leadership sync", "Patricia Tan", "Operations", date, date, date, "08:00", "10:00", "range", 8, "Conference phone", "", "Approved"),
            ("res-006", "room-m5b-conference", "HRD", "E-Sports", "Daniel Cruz", "HRD", date, date, date, "16:00", "23:59", "onwards", 14, "Projector", "", "Approved"),
            ("res-007", "room-m4a-workshop", "Facilities", "Safety briefing", "Nina Dela Cruz", "Facilities", date, date, date, "11:00", "12:30", "range", 18, "Whiteboard", "Awaiting facilities confirmation", "Pending"),
        ]
        db.executemany(
            """
            INSERT INTO reservations
            (id,room_id,reserved_for,event_name,requested_by,department,date,start_date,end_date,start_time,end_time,time_type,attendees,equipment,remarks,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            [item + (timestamp, timestamp) for item in reservations],
        )

    defaults = {
        "preparedBy": "Marisol Santos",
        "reportAudience": "Everyone",
        "includeEmptyRooms": True,
        "emailNotifications": True,
        "approvalReminders": True,
    }
    for key, value in defaults.items():
        db.execute("INSERT OR IGNORE INTO settings (setting_key,setting_value) VALUES (?,?)", (key, json.dumps(value)))


def user_from_row(row: sqlite3.Row | None) -> dict | None:
    if not row:
        return None
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "department": row["department"],
        "status": row["status"],
        "createdAt": row["created_at"],
    }


def room_from_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "type": row["type"],
        "location": row["location"],
        "capacity": row["capacity"],
        "equipment": row["equipment"],
        "status": row["status"],
        "requiresApproval": bool(row["requires_approval"]),
    }


def reservation_from_row(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "roomId": row["room_id"],
        "reservedFor": row["reserved_for"],
        "eventName": row["event_name"],
        "requestedBy": row["requested_by"],
        "department": row["department"],
        "date": row["date"],
        "startDate": row["start_date"],
        "endDate": row["end_date"],
        "startTime": row["start_time"],
        "endTime": row["end_time"],
        "timeType": row["time_type"],
        "attendees": row["attendees"],
        "equipment": row["equipment"],
        "remarks": row["remarks"],
        "status": row["status"],
        "assignmentStatus": row["assignment_status"],
        "rejectionReason": row["rejection_reason"],
        "autoUnassignedAt": row["auto_unassigned_at"],
        "createdAt": row["created_at"],
    }


def database_revision(db: sqlite3.Connection) -> int:
    row = db.execute("SELECT setting_value FROM settings WHERE setting_key = ?", ("__revision",)).fetchone()
    if not row:
        return 0
    try:
        return int(json.loads(row["setting_value"]))
    except (ValueError, TypeError, json.JSONDecodeError):
        return 0


def bump_database_revision(db: sqlite3.Connection) -> int:
    revision = database_revision(db) + 1
    db.execute("INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)", ("__revision", json.dumps(revision)))
    return revision


def settings_from_db(db: sqlite3.Connection) -> dict:
    settings = {}
    for row in db.execute("SELECT setting_key,setting_value FROM settings WHERE setting_key != ?", ("__revision",)):
        try:
            settings[row["setting_key"]] = json.loads(row["setting_value"])
        except json.JSONDecodeError:
            settings[row["setting_key"]] = row["setting_value"]
    return settings


class SchedulerHandler(http.server.BaseHTTPRequestHandler):
    server_version = "AssemblySQLite/1.0"

    def log_message(self, format: str, *args) -> None:
        print("%s - %s" % (self.address_string(), format % args))

    def send_json(self, payload: dict, status: int = 200, headers: dict | None = None) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length) or b"{}")

    def cookie_value(self, name: str) -> str | None:
        cookie_header = self.headers.get("Cookie", "")
        for item in cookie_header.split(";"):
            key, _, value = item.strip().partition("=")
            if key == name:
                return value
        return None

    def current_user(self) -> dict | None:
        token = self.cookie_value("assembly_session")
        session = SESSIONS.get(token or "")
        if not session or session["expires"] < time.time():
            if token:
                SESSIONS.pop(token, None)
            return None
        with connect() as db:
            return user_from_row(db.execute("SELECT * FROM users WHERE id = ? AND status = 'Active'", (session["user_id"],)).fetchone())

    def require_user(self) -> dict | None:
        user = self.current_user()
        if not user:
            self.send_json({"error": "Authentication required"}, 401)
        return user

    def require_admin(self) -> dict | None:
        user = self.require_user()
        if user and user["role"] not in ("Admin", "Super Admin"):
            self.send_json({"error": "Admin access required"}, 403)
            return None
        return user

    def require_superadmin(self) -> dict | None:
        user = self.require_user()
        if user and user["role"] != "Super Admin":
            self.send_json({"error": "Super Admin access required"}, 403)
            return None
        return user

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.api_get(parsed.path)
        else:
            self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.api_post(parsed.path)
        else:
            self.send_json({"error": "Not found"}, 404)

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.api_delete(parsed.path)
        else:
            self.send_json({"error": "Not found"}, 404)

    def api_get(self, path: str) -> None:
        if path == "/api/health":
            self.send_json({"ok": True, "database": str(DB_PATH.name)})
            return
        if path == "/api/public/bootstrap":
            with connect() as db:
                rooms = [
                    {"id": row["id"], "name": row["name"], "capacity": row["capacity"], "status": row["status"]}
                    for row in db.execute("SELECT id,name,capacity,status FROM rooms WHERE status = 'Available' ORDER BY name")
                ]
                reservations = [
                    {
                        "roomId": row["room_id"],
                        "department": row["department"],
                        "startDate": row["start_date"],
                        "endDate": row["end_date"],
                        "startTime": row["start_time"],
                        "endTime": row["end_time"],
                        "status": row["status"],
                        "assignmentStatus": row["assignment_status"],
                    }
                    for row in db.execute(
                        "SELECT room_id,department,start_date,end_date,start_time,end_time,status,assignment_status FROM reservations WHERE status = 'Approved' AND assignment_status != 'Unassigned' ORDER BY start_date,start_time"
                    )
                ]
            self.send_json({"rooms": rooms, "reservations": reservations})
            return
        if path == "/api/session":
            user = self.require_user()
            if user:
                self.send_json({"authenticated": True, "user": user})
            return
        if path == "/api/bootstrap":
            user = self.require_user()
            if not user:
                return
            with connect() as db:
                self.send_json(
                    {
                        "currentUser": user,
                        "rooms": [room_from_row(row) for row in db.execute("SELECT * FROM rooms ORDER BY name")],
                        "reservations": [reservation_from_row(row) for row in db.execute("SELECT * FROM reservations ORDER BY start_date,start_time")],
                        "settings": settings_from_db(db),
                        "revision": database_revision(db),
                    }
                )
            return
        if path == "/api/users":
            if not self.require_admin():
                return
            with connect() as db:
                self.send_json({"users": [user_from_row(row) for row in db.execute("SELECT * FROM users ORDER BY name")]})
            return
        if path == "/api/database":
            user = self.require_admin()
            if not user:
                return
            with connect() as db:
                tables = {
                    "users": [dict(row) for row in db.execute("SELECT id,name,email,role,department,status,created_at,updated_at FROM users ORDER BY id")],
                    "rooms": [dict(row) for row in db.execute("SELECT * FROM rooms ORDER BY name")],
                    "reservations": [dict(row) for row in db.execute("SELECT id,room_id,reserved_for,event_name,requested_by,department,date,start_date,end_date,start_time,end_time,time_type,attendees,equipment,remarks,status,assignment_status,rejection_reason,auto_unassigned_at,created_at,updated_at FROM reservations ORDER BY start_date,start_time")],
                    "settings": [dict(row) for row in db.execute("SELECT setting_key,setting_value FROM settings WHERE setting_key != ? ORDER BY setting_key", ("__revision",))],
                }
            self.send_json({"tables": tables, "canEdit": user["role"] == "Super Admin"})
            return
        self.send_json({"error": "Not found"}, 404)

    def api_post(self, path: str) -> None:
        payload = self.read_json()
        if path == "/api/public/requests":
            department = str(payload.get("department", "")).strip()
            requested_by = str(payload.get("requestedBy", "")).strip()
            purpose = str(payload.get("eventName", "")).strip()
            room_id = str(payload.get("roomId", "")).strip()
            booking_date = str(payload.get("date", "")).strip()
            start_time = str(payload.get("startTime", "")).strip()
            end_time = str(payload.get("endTime", "")).strip()
            urgent = payload.get("urgent") is True
            try:
                time.strptime(booking_date, "%Y-%m-%d")
                start_parts = time.strptime(start_time, "%H:%M")
                end_parts = time.strptime(end_time, "%H:%M")
                start_minutes = start_parts.tm_hour * 60 + start_parts.tm_min
                end_minutes = end_parts.tm_hour * 60 + end_parts.tm_min
                attendees = int(payload.get("attendees", 1))
            except (ValueError, TypeError):
                self.send_json({"error": "Enter a valid date, time, and attendee count."}, 400)
                return
            if not department or not requested_by or not purpose or not room_id:
                self.send_json({"error": "Department, name, purpose, and room are required."}, 400)
                return
            if start_minutes >= end_minutes:
                self.send_json({"error": "Choose an end time after the start time."}, 400)
                return
            if urgent and end_minutes - start_minutes > 30:
                self.send_json({"error": "Urgent bookings can be no longer than 30 minutes."}, 400)
                return
            if attendees < 1:
                self.send_json({"error": "At least one attendee is required."}, 400)
                return
            with connect() as db:
                room = db.execute("SELECT id,name,capacity,status FROM rooms WHERE id = ?", (room_id,)).fetchone()
                if not room or room["status"] != "Available":
                    self.send_json({"error": "That room is not currently available for requests."}, 400)
                    return
                if attendees > room["capacity"]:
                    self.send_json({"error": "The selected room does not have enough seats."}, 400)
                    return
                existing_rows = db.execute(
                    """
                    SELECT start_date,end_date,start_time,end_time
                    FROM reservations
                    WHERE room_id = ?
                      AND status NOT IN ('Cancelled','Rejected')
                      AND assignment_status != 'Unassigned'
                      AND start_date <= ? AND end_date >= ?
                    """,
                    (room_id, booking_date, booking_date),
                ).fetchall()
                for existing in existing_rows:
                    spans_days = existing["start_date"] != existing["end_date"]
                    if spans_days or (start_minutes < int(existing["end_time"][:2]) * 60 + int(existing["end_time"][3:]) and end_minutes > int(existing["start_time"][:2]) * 60 + int(existing["start_time"][3:])):
                        self.send_json({"error": "That room is already reserved for part of this time. Choose another time or room."}, 409)
                        return
                timestamp = now_iso()
                reservation_id = "public-" + secrets.token_urlsafe(10)
                event_name = ("[URGENT · max 30 min] " if urgent else "") + purpose
                db.execute(
                    """
                    INSERT INTO reservations
                    (id,room_id,reserved_for,event_name,requested_by,department,date,start_date,end_date,start_time,end_time,time_type,attendees,equipment,remarks,status,assignment_status,rejection_reason,auto_unassigned_at,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        reservation_id, room_id, department, event_name, requested_by, department, booking_date,
                        booking_date, booking_date, start_time, end_time, "range", attendees,
                        "", str(payload.get("remarks", "")).strip(), "Pending", "Assigned", "", None, timestamp, timestamp,
                    ),
                )
                revision = bump_database_revision(db)
            self.send_json({"ok": True, "id": reservation_id, "revision": revision}, 201)
            return
        if path == "/api/password":
            user = self.require_user()
            if not user:
                return
            current_password = str(payload.get("currentPassword", ""))
            new_password = str(payload.get("newPassword", ""))
            if len(new_password) < 10:
                self.send_json({"error": "Use a password with at least 10 characters."}, 400)
                return
            with connect() as db:
                row = db.execute("SELECT id,password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
                if not row or not verify_password(current_password, row["password_hash"]):
                    self.send_json({"error": "Current password is incorrect."}, 400)
                    return
                db.execute("UPDATE users SET password_hash=?,updated_at=? WHERE id=?", (hash_password(new_password), now_iso(), user["id"]))
            self.send_json({"ok": True})
            return
        if path == "/api/database/update":
            user = self.require_superadmin()
            if not user:
                return
            table = str(payload.get("table", ""))
            record_id = str(payload.get("recordId", ""))
            values = payload.get("values", {})
            allowed = {
                "users": {"name","email","role","department","status"},
                "rooms": {"name","type","location","capacity","equipment","status","requires_approval"},
                "reservations": {"room_id","reserved_for","event_name","requested_by","department","date","start_date","end_date","start_time","end_time","time_type","attendees","equipment","remarks","status","assignment_status","rejection_reason","auto_unassigned_at"},
                "settings": {"setting_value"},
            }
            if table not in allowed or not isinstance(values, dict) or not values or any(key not in allowed[table] for key in values):
                self.send_json({"error": "Choose a supported database record and fields."}, 400)
                return
            try:
                if "capacity" in values:
                    values["capacity"] = int(values["capacity"])
                    if values["capacity"] < 1:
                        raise ValueError()
                if "attendees" in values:
                    values["attendees"] = int(values["attendees"])
                    if values["attendees"] < 0:
                        raise ValueError()
                if "requires_approval" in values:
                    values["requires_approval"] = 1 if str(values["requires_approval"]).lower() in ("1","true","yes","on") else 0
                if table == "users":
                    if "role" in values and values["role"] not in ("Admin", "Employee"):
                        raise ValueError()
                    if "status" in values and values["status"] not in ("Active", "Disabled"):
                        raise ValueError()
                    record_number = int(record_id)
                else:
                    record_number = record_id
            except (TypeError, ValueError):
                self.send_json({"error": "Enter valid values for the selected fields."}, 400)
                return
            with connect() as db:
                if table == "settings":
                    row = db.execute("SELECT setting_key FROM settings WHERE setting_key=?", (record_id,)).fetchone()
                    if not row:
                        self.send_json({"error": "Database record not found."}, 404)
                        return
                    try:
                        parsed_value = json.loads(values["setting_value"])
                    except (json.JSONDecodeError, TypeError):
                        parsed_value = values["setting_value"]
                    db.execute("UPDATE settings SET setting_value=? WHERE setting_key=?", (json.dumps(parsed_value), record_id))
                    bump_database_revision(db)
                    self.send_json({"ok": True})
                    return
                if table == "users":
                    row = db.execute("SELECT id,role FROM users WHERE id=?", (record_number,)).fetchone()
                    if row and row["role"] == "Super Admin" and ({"role","status"} & set(values)):
                        self.send_json({"error": "The Super Admin role and status cannot be changed from the database editor."}, 403)
                        return
                    id_column = "id"
                else:
                    row = db.execute("SELECT id FROM " + table + " WHERE id=?", (record_id,)).fetchone()
                    id_column = "id"
                if not row:
                    self.send_json({"error": "Database record not found."}, 404)
                    return
                assignments = ",".join(key + " = ?" for key in values)
                db.execute("UPDATE " + table + " SET " + assignments + ",updated_at=? WHERE " + id_column + "=?", (*values.values(), now_iso(), record_number))
                bump_database_revision(db)
            self.send_json({"ok": True})
            return
        if path == "/api/login":
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", ""))
            with connect() as db:
                row = db.execute("SELECT * FROM users WHERE email = ? AND status = 'Active'", (email,)).fetchone()
            if not row or not verify_password(password, row["password_hash"]):
                self.send_json({"error": "Invalid email or password"}, 401)
                return
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = {"user_id": row["id"], "expires": time.time() + 8 * 60 * 60}
            self.send_json({"user": user_from_row(row)}, headers={"Set-Cookie": f"assembly_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800"})
            return
        if path == "/api/logout":
            token = self.cookie_value("assembly_session")
            SESSIONS.pop(token or "", None)
            self.send_json({"ok": True}, headers={"Set-Cookie": "assembly_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"})
            return
        if path == "/api/state":
            if not self.require_user():
                return
            revision = self.save_state(payload)
            if revision is None:
                self.send_json({"error": "The schedule changed on another device. Refresh the latest schedule and reapply your change."}, 409)
                return
            self.send_json({"ok": True, "revision": revision})
            return
        if path == "/api/users":
            if not self.require_admin():
                return
            name = str(payload.get("name", "")).strip()
            email = str(payload.get("email", "")).strip().lower()
            password = str(payload.get("password", ""))
            role = "Admin"
            department = str(payload.get("department", "Operations")).strip() or "Operations"
            if not name or not email or len(password) < 10:
                self.send_json({"error": "Name, email, and a password of at least 10 characters are required"}, 400)
                return
            try:
                with connect() as db:
                    timestamp = now_iso()
                    cursor = db.execute(
                        "INSERT INTO users (name,email,password_hash,role,department,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                        (name, email, hash_password(password), role, department, "Active", timestamp, timestamp),
                    )
                    row = db.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
                self.send_json({"user": user_from_row(row)}, 201)
            except sqlite3.IntegrityError:
                self.send_json({"error": "An account with that email already exists"}, 409)
            return
        self.send_json({"error": "Not found"}, 404)

    def api_delete(self, path: str) -> None:
        if path.startswith("/api/users/"):
            current = self.require_admin()
            if not current:
                return
            try:
                user_id = int(path.rsplit("/", 1)[1])
            except ValueError:
                self.send_json({"error": "Invalid account id"}, 400)
                return
            if user_id == current["id"]:
                self.send_json({"error": "You cannot delete your own active account"}, 400)
                return
            with connect() as db:
                target = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if not target:
                    self.send_json({"error": "Account not found"}, 404)
                    return
                if target["role"] == "Super Admin":
                    self.send_json({"error": "Super Admin accounts cannot be deleted here."}, 403)
                    return
                if target["role"] == "Admin" and db.execute("SELECT COUNT(*) AS count FROM users WHERE role = 'Admin' AND status = 'Active'").fetchone()["count"] <= 1:
                    self.send_json({"error": "Keep at least one active admin account"}, 400)
                    return
                db.execute("DELETE FROM users WHERE id = ?", (user_id,))
            self.send_json({"ok": True})
            return
        self.send_json({"error": "Not found"}, 404)

    def save_state(self, payload: dict) -> int | None:
        rooms = payload.get("rooms", [])
        reservations = payload.get("reservations", [])
        settings = payload.get("settings", {})
        timestamp = now_iso()
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current_revision = database_revision(db)
            try:
                expected_revision = int(payload.get("revision", current_revision))
            except (TypeError, ValueError):
                db.rollback()
                return None
            if expected_revision != current_revision:
                db.rollback()
                return None
            db.execute("DELETE FROM reservations")
            db.execute("DELETE FROM rooms")
            for room in rooms:
                db.execute(
                    "INSERT INTO rooms (id,name,type,location,capacity,equipment,status,requires_approval,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (room.get("id"), room.get("name", ""), room.get("type", "Meeting Room"), room.get("location", ""), int(room.get("capacity", 1)), room.get("equipment", ""), room.get("status", "Available"), int(bool(room.get("requiresApproval"))), timestamp, timestamp),
                )
            for reservation in reservations:
                start_date = reservation.get("startDate") or reservation.get("date")
                end_date = reservation.get("endDate") or reservation.get("date") or start_date
                db.execute(
                    """
                    INSERT INTO reservations
                    (id,room_id,reserved_for,event_name,requested_by,department,date,start_date,end_date,start_time,end_time,time_type,attendees,equipment,remarks,status,assignment_status,rejection_reason,auto_unassigned_at,created_at,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        reservation.get("id"), reservation.get("roomId"), reservation.get("reservedFor", ""), reservation.get("eventName", ""), reservation.get("requestedBy", ""), reservation.get("department", ""), reservation.get("date") or start_date, start_date, end_date, reservation.get("startTime", "09:00"), reservation.get("endTime", "10:00"), reservation.get("timeType", "range"), int(reservation.get("attendees", 0) or 0), reservation.get("equipment", ""), reservation.get("remarks", ""), reservation.get("status", "Pending"), reservation.get("assignmentStatus", "Assigned"), reservation.get("rejectionReason", ""), reservation.get("autoUnassignedAt"), reservation.get("createdAt") or timestamp, timestamp,
                    ),
                )
            for key, value in settings.items():
                if key != "__revision":
                    db.execute("INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)", (key, json.dumps(value)))
            revision = current_revision + 1
            db.execute("INSERT OR REPLACE INTO settings (setting_key,setting_value) VALUES (?,?)", ("__revision", json.dumps(revision)))
            db.commit()
            return revision

    def serve_static(self, request_path: str) -> None:
        relative = unquote(request_path.lstrip("/")) or "index.html"
        candidate = (ROOT / relative).resolve()
        if ROOT not in candidate.parents and candidate != ROOT:
            self.send_error(403)
            return
        if not candidate.is_file():
            self.send_error(404)
            return
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        body = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    initialize_database()
    print(f"Assembly Room Scheduler running at http://127.0.0.1:{PORT}")
    print("Demo admin: admin@assembly.local / admin123")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), SchedulerHandler).serve_forever()
