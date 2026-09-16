import json
import os
import secrets
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

from pymongo import MongoClient
from bson import ObjectId

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MONGODB_URI = os.environ.get(
    "MONGODB_URI",
    "mongodb+srv://krishu2415:6cl0D3k1tG4YdP7y@cluster0.9woa6.mongodb.net/"
)
DB_NAME = "election_db"
PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("HOST", "127.0.0.1")
if os.environ.get("RENDER"):
    HOST = "0.0.0.0"

COLLEGE_NAME = "College of Engineering"
DEPARTMENTS = ["AI & ML", "Computer Engineering", "Civil Engineering", "Electronics & Telecommunication"]
ADMIN_USERS = {"admin": "admin123"}
STATUSES = {"draft", "open", "paused", "closed", "published"}

tokens = {}
uploads = {}
write_lock = threading.Lock()

_client = None
_db = None


def get_db():
    global _client, _db
    if _db is None:
        _client = MongoClient(MONGODB_URI)
        _db = _client[DB_NAME]
    return _db


def col(name):
    return get_db()[name]


def now():
    return datetime.now().isoformat(timespec="seconds")


def make_id(prefix):
    return prefix + secrets.token_hex(4)


def make_pin():
    return str(secrets.randbelow(900000) + 100000)


def init_db():
    db = get_db()
    db.students.create_index("id", unique=True)
    db.elections.create_index("id", unique=True)
    db.positions.create_index("election_id")
    db.candidates.create_index("position_id")
    db.voter_status.create_index([("election_id", 1), ("student_id", 1)], unique=True)
    db.ballots.create_index("election_id")
    db.ballots.create_index([("ballot_id", 1), ("election_id", 1), ("position_id", 1)], unique=True)
    db.election_departments.create_index([("election_id", 1), ("department", 1)], unique=True)
    db.audit_log.create_index("id", unique=True)

    count = db.elections.count_documents({})
    if count == 0:
        seed()
        audit("System initialized with demo data")


def heal_demo_election():
    db = get_db()
    rows = list(db.elections.find({}, {"id": 1, "title": 1, "status": 1}))
    if len(rows) == 1 and rows[0]["title"] == "General Secretary & College President Election 2026":
        eid = rows[0]["id"]
        ballots = db.ballots.count_documents({"election_id": eid})
        if ballots == 0 and rows[0]["status"] != "open":
            db.voter_status.delete_many({"election_id": eid})
            db.elections.update_one({"id": eid}, {"$set": {"status": "open"}})
            print("  [self-heal] Demo election reopened for voting (no ballots were cast).")


def audit(action):
    db = get_db()
    db.audit_log.insert_one({"id": make_id("a_"), "at": now(), "action": action})


def seed():
    db = get_db()
    students = [
        {"id": "AIML_01", "name": "Suraj Jadhav", "department": "AI & ML", "year": "SE", "pin": "482913"},
        {"id": "AIML_62", "name": "Aditya Pawar", "department": "AI & ML", "year": "SE", "pin": "773102"},
        {"id": "CIVIL_03", "name": "Aditya Patil", "department": "Civil Engineering", "year": "SE", "pin": "990481"},
        {"id": "CSE_07", "name": "Priya Sharma", "department": "Computer Engineering", "year": "TE", "pin": "216907"},
        {"id": "CSE_12", "name": "Rohan Verma", "department": "Computer Engineering", "year": "SE", "pin": "548320"},
        {"id": "ETC_04", "name": "Sneha Kulkarni", "department": "Electronics & Telecommunication", "year": "BE", "pin": "631845"},
        {"id": "CIVIL_09", "name": "Varun Deshmukh", "department": "Civil Engineering", "year": "BE", "pin": "118276"},
        {"id": "ETC_15", "name": "Kavya Nair", "department": "Electronics & Telecommunication", "year": "TE", "pin": "905614"},
    ]
    for s in students:
        try:
            db.students.insert_one(s)
        except Exception:
            pass

    eid = make_id("e_")
    db.elections.insert_one({
        "id": eid,
        "title": "General Secretary & College President Election 2026",
        "type": "college-wide",
        "status": "open",
        "created_at": now(),
    })
    for d in DEPARTMENTS:
        try:
            db.election_departments.insert_one({"election_id": eid, "department": d})
        except Exception:
            pass

    positions = [
        ("General Secretary", "Manages council coordination, communications and documentation across all departments.", [
            ("Suraj Jadhav", "AI & ML", "SE", "Digital documentation, transparent records, student newsletter", "⚙️"),
            ("Sneha Kulkarni", "Electronics & Telecommunication", "BE", "Streamlined communication, event coordination, council accountability", "🛰️"),
            ("Aditya Patil", "Civil Engineering", "SE", "Organized record systems, health & safety bulletins, campus outreach", "🏗️"),
        ]),
        ("College President", "Represents all engineering students and heads the student council.", [
            ("Priya Sharma", "Computer Engineering", "TE", "Tech literacy programs, career placement, campus innovation hub", "💻"),
            ("Rohan Verma", "Computer Engineering", "SE", "Scholarship expansion, student welfare, inclusive governance", "🎯"),
            ("Kavya Nair", "Electronics & Telecommunication", "TE", "Mental health programs, campus-wide Wi-Fi, sustainability drive", "🌐"),
        ]),
        ("Sports & Cultural Coordinator", "Organizes inter-department sports, cultural festivals and student events.", [
            ("Varun Deshmukh", "Civil Engineering", "BE", "Annual sports meet, inter-department tournaments, fitness initiatives", "🏆"),
            ("Aditya Pawar", "AI & ML", "SE", "Cultural fest, arts funding, student creative spaces", "🎭"),
        ]),
    ]
    for title, desc, cands in positions:
        pid = make_id("p_")
        db.positions.insert_one({
            "id": pid,
            "election_id": eid,
            "title": title,
            "description": desc,
        })
        for name, dept, year, platform, symbol in cands:
            db.candidates.insert_one({
                "id": make_id("c_"),
                "position_id": pid,
                "name": name,
                "department": dept,
                "year": year,
                "platform": platform,
                "symbol": symbol,
                "photo": None,
            })


def student_eligible(student, election_id, etype):
    if etype == "college-wide":
        return True
    row = db.election_departments.find_one({"election_id": election_id, "department": student["department"]})
    return row is not None


def compute_results(election_id):
    db = get_db()
    election = db.elections.find_one({"id": election_id})
    if not election:
        return None
    positions = list(db.positions.find({"election_id": election_id}))
    total_students = db.students.count_documents({})
    eligible = total_students
    if election["type"] != "college-wide":
        depts = [r["department"] for r in db.election_departments.find({"election_id": election_id})]
        if depts:
            eligible = db.students.count_documents({"department": {"$in": depts}})
        else:
            eligible = 0
    votes = len(db.ballots.distinct("ballot_id", {"election_id": election_id}))
    turnout = round((votes / eligible) * 100) if eligible > 0 else 0

    out_positions = []
    for p in positions:
        cand_rows = list(db.candidates.find({"position_id": p["id"]}))
        tally = {}
        for c in cand_rows:
            tally[c["id"]] = db.ballots.count_documents({
                "election_id": election_id,
                "position_id": p["id"],
                "candidate_id": c["id"],
            })
        tally["NOTA"] = db.ballots.count_documents({
            "election_id": election_id,
            "position_id": p["id"],
            "candidate_id": "NOTA",
        })
        position_total = sum(tally.values())
        max_votes = max(tally.values()) if tally else 0
        rows = []
        for c in cand_rows:
            v = tally.get(c["id"], 0)
            rows.append({
                "id": c["id"],
                "name": c["name"],
                "department": c["department"],
                "photo": c.get("photo"),
                "symbol": c.get("symbol"),
                "votes": v,
                "pct": round((v / position_total) * 100) if position_total > 0 else 0,
                "winner": v == max_votes and v > 0,
            })
        nota_v = tally.get("NOTA", 0)
        rows.append({
            "id": "NOTA",
            "name": "NOTA",
            "department": "",
            "photo": None,
            "symbol": None,
            "votes": nota_v,
            "pct": round((nota_v / position_total) * 100) if position_total > 0 else 0,
            "winner": nota_v == max_votes and nota_v > 0,
        })
        out_positions.append({
            "id": p["id"],
            "title": p["title"],
            "description": p["description"],
            "total": position_total,
            "rows": rows,
        })
    return {
        "election": {
            "id": election["id"],
            "title": election["title"],
            "status": election["status"],
            "type": election["type"],
        },
        "stats": {"votes": votes, "eligible": eligible, "turnout": turnout},
        "positions": out_positions,
    }


def build_election_detail(election):
    db = get_db()
    depts = [r["department"] for r in db.election_departments.find({"election_id": election["id"]})]
    positions = []
    for p in db.positions.find({"election_id": election["id"]}):
        candidates = list(db.candidates.find({"position_id": p["id"]}))
        for c in candidates:
            c.pop("_id", None)
        positions.append({
            "id": p["id"],
            "title": p["title"],
            "description": p.get("description", ""),
            "candidates": candidates,
        })
    ballots = len(db.ballots.distinct("ballot_id", {"election_id": election["id"]}))
    eligible = compute_eligible_count(election)
    return {
        "id": election["id"],
        "title": election["title"],
        "type": election["type"],
        "status": election["status"],
        "created_at": election["created_at"],
        "departments": depts,
        "positions": positions,
        "ballots": ballots,
        "eligible_count": eligible,
    }


def compute_eligible_count(election):
    db = get_db()
    if election["type"] == "college-wide":
        return db.students.count_documents({})
    depts = [r["department"] for r in db.election_departments.find({"election_id": election["id"]})]
    if not depts:
        return 0
    return db.students.count_documents({"department": {"$in": depts}})


def validate_election_payload(data):
    if not data.get("title") or not str(data["title"]).strip():
        return "Election title is required"
    if data.get("type") not in ("college-wide", "department"):
        return "Invalid election type"
    depts = data.get("departments") or []
    if not isinstance(depts, list) or len(depts) == 0:
        return "Select at least one department"
    positions = data.get("positions") or []
    if not isinstance(positions, list) or len(positions) == 0:
        return "Add at least one position"
    for p in positions:
        if not p.get("title") or not str(p["title"]).strip():
            return "Position title required"
    return None


def replace_election_payload(election_id, data):
    db = get_db()
    db.election_departments.delete_many({"election_id": election_id})
    for d in data.get("departments", []):
        try:
            db.election_departments.insert_one({"election_id": election_id, "department": d})
        except Exception:
            pass

    existing_pos = {r["id"]: r for r in db.positions.find({"election_id": election_id})}
    existing_pos_ids = set(existing_pos.keys())
    new_pos_ids = set()

    for p in data.get("positions", []):
        pid = p.get("id")
        is_existing_pos = pid and pid in existing_pos_ids

        if is_existing_pos:
            db.positions.update_one(
                {"id": pid},
                {"$set": {"title": p["title"], "description": p.get("description", "")}},
            )
        else:
            pid = make_id("p_")
            db.positions.insert_one({
                "id": pid,
                "election_id": election_id,
                "title": p["title"],
                "description": p.get("description", ""),
            })
        new_pos_ids.add(pid)

        existing_cand = {r["id"]: r for r in db.candidates.find({"position_id": pid})}
        existing_cand_ids = set(existing_cand.keys())
        new_cand_ids = set()

        for c in p.get("candidates", []):
            if not c.get("name") or not str(c["name"]).strip():
                continue
            cid = c.get("id")
            is_existing_cand = cid and cid in existing_cand_ids

            payload = {
                "name": c["name"],
                "department": c.get("department", ""),
                "year": c.get("year", ""),
                "platform": c.get("platform", ""),
                "symbol": c.get("symbol", ""),
                "photo": c.get("photo"),
            }

            if is_existing_cand:
                db.candidates.update_one({"id": cid}, {"$set": payload})
                new_cand_ids.add(cid)
            else:
                cid = make_id("c_")
                payload["id"] = cid
                payload["position_id"] = pid
                db.candidates.insert_one(payload)
                new_cand_ids.add(cid)

        removed = existing_cand_ids - new_cand_ids
        if removed:
            db.candidates.delete_many({"position_id": pid, "id": {"$in": list(removed)}})

    removed_pos = existing_pos_ids - new_pos_ids
    if removed_pos:
        for oid in removed_pos:
            db.candidates.delete_many({"position_id": oid})
        db.positions.delete_many({"id": {"$in": list(removed_pos)}})


def make_token(role, student_id=None):
    tok = secrets.token_hex(16)
    tokens[tok] = {"role": role, "student_id": student_id}
    return tok


def authorize(handler, role):
    hdr = handler.headers.get("Authorization") or ""
    token = hdr.replace("Bearer ", "") if hdr.startswith("Bearer ") else ""
    info = tokens.get(token)
    if not info or info["role"] != role:
        return None
    return info


class Handler(BaseHTTPRequestHandler):
    server_version = "SAE/1.0"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-store")

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _text(self, code, text, ctype="text/plain; charset=utf-8"):
        data = text.encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _file(self, path):
        if not os.path.isfile(path):
            self._json(404, {"ok": False, "error": "Not found"})
            return
        ctype = "application/octet-stream"
        if path.endswith(".html"):
            ctype = "text/html; charset=utf-8"
        elif path.endswith(".js"):
            ctype = "application/javascript; charset=utf-8"
        elif path.endswith(".css"):
            ctype = "text/css; charset=utf-8"
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length else b""
            return json.loads(body) if body else {}
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        parts = [unquote(p) for p in path.split("/") if p]

        if path == "/" or path == "/index.html":
            self._file(os.path.join(BASE_DIR, "index.html"))
            return
        if path in ("/app.js", "/style.css"):
            self._file(os.path.join(BASE_DIR, path.lstrip("/")))
            return

        if parts[:2] == ["api", "results"] and len(parts) == 3:
            res = compute_results(parts[2])
            if not res:
                self._json(404, {"ok": False, "error": "Election not found"})
                return
            self._json(200, {"ok": True, **res})
            return

        if parts[:2] == ["api", "my"] and parts[2] == "elections":
            info = authorize(self, "student")
            if not info:
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            db = get_db()
            student = db.students.find_one({"id": info["student_id"]})
            if not student:
                self._json(401, {"ok": False, "error": "Student not found"})
                return
            elections = list(db.elections.find({}))
            available, others = [], []
            for e in elections:
                voted = db.voter_status.find_one({"election_id": e["id"], "student_id": student["id"]}) is not None
                detail = build_election_detail(e)
                eligible = student_eligible(dict(student), e["id"], e["type"])
                if e["status"] == "open" and eligible and not voted:
                    available.append({**detail, "voted": voted})
                else:
                    others.append({
                        "id": e["id"], "title": e["title"], "type": e["type"],
                        "status": e["status"], "voted": voted, "eligible": eligible,
                    })
            self._json(200, {"ok": True, "available": available, "others": others})
            return

        if parts[:2] == ["api", "admin"] and len(parts) >= 3:
            if not authorize(self, "admin"):
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            db = get_db()
            if parts[2] == "elections" and len(parts) == 3:
                rows = list(db.elections.find({}))
                out = []
                for e in rows:
                    detail = build_election_detail(e)
                    out.append({
                        "id": e["id"], "title": e["title"], "type": e["type"],
                        "status": e["status"], "created_at": e["created_at"],
                        "positions_count": len(detail["positions"]),
                        "ballots": detail["ballots"],
                        "eligible_count": detail["eligible_count"],
                    })
                self._json(200, {"ok": True, "elections": out})
                return
            if parts[2] == "elections" and len(parts) == 4:
                row = db.elections.find_one({"id": parts[3]})
                if not row:
                    self._json(404, {"ok": False, "error": "Election not found"})
                    return
                detail = build_election_detail(row)
                self._json(200, {"ok": True, **detail})
                return
            if parts[2] == "students" and len(parts) == 3:
                rows = list(db.students.find({}, {"_id": 0}))
                self._json(200, {"ok": True, "students": rows})
                return
            if parts[2] == "audit" and len(parts) == 3:
                rows = list(db.audit_log.find({}, {"_id": 0}).sort("id", -1).limit(300))
                self._json(200, {"ok": True, "log": rows})
                return
            if parts[2] == "export" and len(parts) == 4:
                res = compute_results(parts[3])
                if not res:
                    self._json(404, {"ok": False, "error": "Election not found"})
                    return
                csv = "Position,Candidate,Votes,Percentage\n"
                for pos in res["positions"]:
                    for row in pos["rows"]:
                        csv += f'{pos["title"]},{row["name"]},{row["votes"]},{row["pct"]}%\n'
                self._text(200, csv, "text/csv; charset=utf-8")
                return
            self._json(404, {"ok": False, "error": "Unknown endpoint"})
            return

        self._json(404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        global _db
        parsed = urlparse(self.path)
        path = parsed.path
        parts = [unquote(p) for p in path.split("/") if p]
        data = self._json_body()
        db = get_db()

        if parts == ["api", "login"]:
            sid = str(data.get("student_id", "")).strip()
            pin = str(data.get("pin", "")).strip()
            student = db.students.find_one({"id": sid})
            if not student or student["pin"] != pin or (not sid and not pin):
                self._json(401, {"ok": False, "error": "Invalid Student ID or PIN"})
                return
            tok = make_token("student", student["id"])
            self._json(200, {"ok": True, "token": tok, "student": {
                "id": student["id"], "name": student["name"],
                "department": student["department"], "year": student["year"],
            }})
            return

        if parts == ["api", "admin", "login"]:
            u = str(data.get("username", "")).strip()
            p = str(data.get("password", "")).strip()
            if ADMIN_USERS.get(u) != p:
                self._json(401, {"ok": False, "error": "Invalid admin credentials"})
                return
            tok = make_token("admin")
            audit(f'Admin "{u}" logged in')
            self._json(200, {"ok": True, "token": tok})
            return

        if parts == ["api", "vote"]:
            info = authorize(self, "student")
            if not info:
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            election_id = str(data.get("election_id", ""))
            selections = data.get("selections") or {}
            with write_lock:
                try:
                    election = db.elections.find_one({"id": election_id})
                    if not election:
                        self._json(404, {"ok": False, "error": "Election not found"})
                        return
                    if election["status"] != "open":
                        self._json(409, {"ok": False, "error": "Voting is not open"})
                        return
                    student = db.students.find_one({"id": info["student_id"]})
                    if not student:
                        self._json(401, {"ok": False, "error": "Student not found"})
                        return
                    if election["type"] != "college-wide":
                        okd = db.election_departments.find_one({
                            "election_id": election_id,
                            "department": student["department"],
                        })
                        if not okd:
                            self._json(403, {"ok": False, "error": "You are not eligible for this election"})
                            return
                    positions = list(db.positions.find({"election_id": election_id}))
                    pos_ids = {p["id"] for p in positions}
                    if set(selections.keys()) != pos_ids:
                        self._json(400, {"ok": False, "error": "Every position must have exactly one selection"})
                        return
                    for pid, cid in selections.items():
                        if cid != "NOTA":
                            okc = db.candidates.find_one({"id": cid, "position_id": pid})
                            if not okc:
                                self._json(400, {"ok": False, "error": "Invalid candidate selection"})
                                return
                    receipt = "SAE-" + secrets.token_hex(4).upper()
                    ts = now()
                    existing_vote = db.voter_status.find_one({
                        "election_id": election_id,
                        "student_id": info["student_id"],
                    })
                    if existing_vote:
                        self._json(409, {"ok": False, "error": "This student has already voted in this election"})
                        return
                    db.voter_status.insert_one({
                        "election_id": election_id,
                        "student_id": info["student_id"],
                        "receipt_no": receipt,
                        "voted_at": ts,
                    })
                    ballot_id = "b" + secrets.token_hex(5)
                    for pid, cid in selections.items():
                        db.ballots.insert_one({
                            "ballot_id": ballot_id,
                            "election_id": election_id,
                            "position_id": pid,
                            "candidate_id": cid,
                            "voted_at": ts,
                        })
                    self._json(200, {"ok": True, "receipt": receipt})
                except Exception as ex:
                    self._json(500, {"ok": False, "error": "Server error: " + str(ex)})
            return

        if parts[:3] == ["api", "admin", "elections"] and len(parts) == 3 and path.count("/") == 3:
            if not authorize(self, "admin"):
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            validator = validate_election_payload(data)
            if validator:
                self._json(400, {"ok": False, "error": validator})
                return
            with write_lock:
                try:
                    eid = make_id("e_")
                    db.elections.insert_one({
                        "id": eid,
                        "title": data["title"].strip(),
                        "type": data["type"],
                        "status": "draft",
                        "created_at": now(),
                    })
                    replace_election_payload(eid, data)
                    audit(f'Created election "{data["title"].strip()}"')
                except Exception as ex:
                    self._json(500, {"ok": False, "error": str(ex)})
                    return
            self._json(200, {"ok": True, "id": eid})
            return

        if parts[:3] == ["api", "admin", "elections"] and len(parts) == 5 and parts[4] == "status":
            if not authorize(self, "admin"):
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            status = data.get("status")
            if status not in STATUSES:
                self._json(400, {"ok": False, "error": "Invalid status"})
                return
            with write_lock:
                try:
                    row = db.elections.find_one({"id": parts[3]})
                    if not row:
                        self._json(404, {"ok": False, "error": "Election not found"})
                        return
                    db.elections.update_one({"id": parts[3]}, {"$set": {"status": status}})
                    audit(f'Set election "{row["title"]}" status to {status}')
                except Exception as ex:
                    self._json(500, {"ok": False, "error": str(ex)})
                    return
            self._json(200, {"ok": True})
            return

        if parts[:3] == ["api", "admin", "students"] and len(parts) == 4 and parts[3] == "import":
            if not authorize(self, "admin"):
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            if not data.get("confirm"):
                records = data.get("records") or []
                seen = set()
                valid, duplicates, invalid = [], [], []
                for r in records:
                    sid = str(r.get("id", "")).strip()
                    name = str(r.get("name", "")).strip()
                    dept = str(r.get("department", "")).strip()
                    year = str(r.get("year", "")).strip() or "SE"
                    if not sid or not name or not dept:
                        invalid.append({"row": r, "reason": "Missing ID, name or department"})
                        continue
                    if sid in seen:
                        duplicates.append(sid)
                        continue
                    seen.add(sid)
                    dup = db.students.find_one({"id": sid})
                    if dup:
                        duplicates.append(sid)
                        continue
                    valid.append({"id": sid, "name": name, "department": dept, "year": year, "pin": make_pin()})
                token = secrets.token_hex(8)
                uploads[token] = {"records": valid, "at": now()}
                self._json(200, {"ok": True, "upload_token": token, "valid": valid, "duplicates": duplicates, "invalid": invalid})
                return
            token = str(data.get("upload_token", ""))
            staged = uploads.pop(token, None)
            if not staged:
                self._json(400, {"ok": False, "error": "Upload session expired. Please try again."})
                return
            with write_lock:
                try:
                    inserted = 0
                    for r in staged["records"]:
                        try:
                            db.students.insert_one({
                                "id": r["id"],
                                "name": r["name"],
                                "department": r["department"],
                                "year": r["year"],
                                "pin": r["pin"],
                            })
                            inserted += 1
                        except Exception:
                            pass
                    audit(f"Imported {inserted} students")
                except Exception as ex:
                    self._json(500, {"ok": False, "error": str(ex)})
                    return
            self._json(200, {"ok": True, "inserted": inserted})
            return

        self._json(404, {"ok": False, "error": "Unknown endpoint"})

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        parts = [unquote(p) for p in path.split("/") if p]
        data = self._json_body()
        db = get_db()

        if parts[:3] == ["api", "admin", "elections"] and len(parts) == 4:
            if not authorize(self, "admin"):
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            eid = parts[3]
            with write_lock:
                try:
                    row = db.elections.find_one({"id": eid})
                    if not row:
                        self._json(404, {"ok": False, "error": "Election not found"})
                        return
                    has_ballots = db.ballots.count_documents({"election_id": eid}) > 0
                    title = str(data.get("title", row["title"])).strip() or row["title"]
                    if has_ballots:
                        detail = build_election_detail(row)
                        payload_positions = data.get("positions")
                        payload_depts = data.get("departments")
                        payload_type = data.get("type")
                        same = True
                        if payload_positions is not None and (
                            len(payload_positions) != len(detail["positions"])
                            or not all(
                                p.get("title") == dp["title"]
                                and sorted(x.get("id") for x in p.get("candidates", [])) == sorted(x["id"] for x in dp["candidates"])
                                for p, dp in zip(payload_positions, detail["positions"])
                            )
                        ):
                            same = False
                        if payload_depts is not None and set(payload_depts) != set(detail["departments"]):
                            same = False
                        if payload_type is not None and payload_type != detail["type"]:
                            same = False
                        if not same:
                            self._json(400, {"ok": False, "error": "Election structure is locked once ballots exist. Only the title can be changed."})
                            return
                        db.elections.update_one({"id": eid}, {"$set": {"title": title}})
                        audit(f'Updated title of election "{title}"')
                        self._json(200, {"ok": True})
                        return
                    validator = validate_election_payload(data)
                    if validator:
                        self._json(400, {"ok": False, "error": validator})
                        return
                    db.elections.update_one({"id": eid}, {"$set": {"type": data["type"], "title": title}})
                    replace_election_payload(eid, data)
                    audit(f'Updated election "{title}"')
                except Exception as ex:
                    self._json(500, {"ok": False, "error": str(ex)})
                    return
            self._json(200, {"ok": True})
            return

        self._json(404, {"ok": False, "error": "Unknown endpoint"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        parts = [unquote(p) for p in path.split("/") if p]
        db = get_db()

        if parts[:3] == ["api", "admin", "elections"] and len(parts) == 4:
            if not authorize(self, "admin"):
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            eid = parts[3]
            with write_lock:
                try:
                    row = db.elections.find_one({"id": eid})
                    if not row:
                        self._json(404, {"ok": False, "error": "Election not found"})
                        return
                    pids = [r["id"] for r in db.positions.find({"election_id": eid}, {"id": 1})]
                    if pids:
                        db.candidates.delete_many({"position_id": {"$in": pids}})
                        db.ballots.delete_many({"position_id": {"$in": pids}})
                    db.positions.delete_many({"election_id": eid})
                    db.ballots.delete_many({"election_id": eid})
                    db.voter_status.delete_many({"election_id": eid})
                    db.election_departments.delete_many({"election_id": eid})
                    db.elections.delete_one({"id": eid})
                    audit(f'Deleted election "{row["title"]}"')
                except Exception as ex:
                    self._json(500, {"ok": False, "error": str(ex)})
                    return
            self._json(200, {"ok": True})
            return

        if parts[:3] == ["api", "admin", "students"] and len(parts) == 4:
            if not authorize(self, "admin"):
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            sid = parts[3]
            with write_lock:
                try:
                    db.voter_status.delete_many({"student_id": sid})
                    db.students.delete_one({"id": sid})
                    audit(f'Removed student "{sid}"')
                finally:
                    pass
            self._json(200, {"ok": True})
            return

        if parts[:3] == ["api", "admin", "audit"] and len(parts) == 3:
            if not authorize(self, "admin"):
                self._json(401, {"ok": False, "error": "Not authorized"})
                return
            with write_lock:
                try:
                    db.audit_log.delete_many({})
                finally:
                    pass
            self._json(200, {"ok": True})
            return

        self._json(404, {"ok": False, "error": "Unknown endpoint"})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    init_db()
    heal_demo_election()

    class NoReuseServer(ThreadingHTTPServer):
        allow_reuse_address = False

    try:
        server = NoReuseServer((HOST, PORT), Handler)
    except OSError:
        print("  Port %d is already in use - the server appears to already be running." % PORT)
        print("  Just open http://localhost:%d in your browser." % PORT)
        raise SystemExit(0)
    print("=" * 56)
    print("  Student Association Election System")
    print(f"  Database : MongoDB ({DB_NAME})")
    print(f"  URL      : http://{HOST}:{PORT}")
    print("  Admin    : admin / admin123")
    print("  Demo voters (ID / PIN):")
    print("    AIML_01 / 482913   | CSE_07 / 216907")
    print("    CSE_12 / 548320    | ETC_15 / 905614")
    print("  Press Ctrl+C to stop.")
    print("=" * 56)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if _client:
            _client.close()