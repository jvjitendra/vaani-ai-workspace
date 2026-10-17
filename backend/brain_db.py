"""
Vaani AI Workspace — Brain Database Engine
Persistent local SQLite storage for Memories, Conversation Archives, and File Knowledge Library.
Uses SQLite FTS5 for zero-dependency, ultra-fast BM25 full-text indexing and retrieval.
"""

import os
import sqlite3
import json
import hashlib
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent
# Store persistent database outside the actively-watched Live Server tree
DEFAULT_DATA_DIR = Path.home() / ".vaani_data"
DATA_DIR = Path(os.environ.get("VAANI_DATA_DIR", str(DEFAULT_DATA_DIR)))
LIBRARY_DIR = DATA_DIR / "library"
DB_PATH = DATA_DIR / "vaani_brain.db"

def now_ist():
    return datetime.now(ZoneInfo("Asia/Kolkata")).isoformat()

def get_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    
    # Preserve and migrate any existing database
    legacy_db = BASE_DIR / "data" / "vaani_brain.db"
    if legacy_db.exists() and not DB_PATH.exists():
        try:
            import shutil
            shutil.copy2(str(legacy_db), str(DB_PATH))
        except Exception:
            pass

    conn = sqlite3.connect(str(DB_PATH), timeout=20.0)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    with conn:
        # 1. Persistent Memories
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                content TEXT NOT NULL UNIQUE,
                category TEXT DEFAULT 'general',
                source TEXT DEFAULT 'user_explicit',
                created_at TEXT,
                updated_at TEXT
            )
        """)
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
                content,
                category,
                content='memories',
                content_rowid='id'
            )
        """)

        # Triggers to keep FTS in sync with memories
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
                INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
            END;
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES('delete', old.id, old.content, old.category);
            END;
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
                INSERT INTO memories_fts(memories_fts, rowid, content, category) VALUES('delete', old.id, old.content, old.category);
                INSERT INTO memories_fts(rowid, content, category) VALUES (new.id, new.content, new.category);
            END;
        """)

        # 2. Historical Conversations and Messages
        conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                title TEXT,
                created_at TEXT,
                updated_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
                content,
                role,
                conversation_id UNINDEXED,
                content='messages',
                content_rowid='id'
            )
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, content, role, conversation_id) VALUES (new.id, new.content, new.role, new.conversation_id);
            END;
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content, role, conversation_id) VALUES('delete', old.id, old.content, old.role, old.conversation_id);
            END;
        """)

        # 3. Permanent File Knowledge Library
        conn.execute("""
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                file_type TEXT,
                file_size INTEGER,
                char_count INTEGER,
                chunk_count INTEGER,
                uploaded_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS doc_chunks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                doc_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                FOREIGN KEY (doc_id) REFERENCES documents(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
                content,
                doc_id UNINDEXED,
                metadata UNINDEXED,
                content='doc_chunks',
                content_rowid='id'
            )
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS doc_chunks_ai AFTER INSERT ON doc_chunks BEGIN
                INSERT INTO doc_chunks_fts(rowid, content, doc_id, metadata) VALUES (new.id, new.content, new.doc_id, new.metadata);
            END;
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS doc_chunks_ad AFTER DELETE ON doc_chunks BEGIN
                INSERT INTO doc_chunks_fts(doc_chunks_fts, rowid, content, doc_id, metadata) VALUES('delete', old.id, old.content, old.doc_id, old.metadata);
            END;
        """)

    conn.close()

# ----------------- Memory Management -----------------

def save_memory(content: str, category: str = "general", source: str = "user_explicit") -> dict:
    content = content.strip()
    if not content:
        raise ValueError("Memory content cannot be empty")
    ts = now_ist()
    conn = get_db()
    with conn:
        # Check if identical exists
        cur = conn.execute("SELECT id FROM memories WHERE content = ?", (content,))
        row = cur.fetchone()
        if row:
            conn.execute("UPDATE memories SET updated_at = ?, category = ?, source = ? WHERE id = ?", (ts, category, source, row["id"]))
            mem_id = row["id"]
        else:
            cur = conn.execute(
                "INSERT INTO memories (content, category, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (content, category, source, ts, ts)
            )
            mem_id = cur.lastrowid
    conn.close()
    return {"id": mem_id, "content": content, "category": category, "source": source, "updated_at": ts}

def list_memories() -> list:
    conn = get_db()
    cur = conn.execute("SELECT id, content, category, source, created_at, updated_at FROM memories ORDER BY id DESC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def delete_memory(memory_id: int) -> bool:
    conn = get_db()
    with conn:
        cur = conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        deleted = cur.rowcount > 0
    conn.close()
    return deleted

def search_memories(query: str, limit: int = 5) -> list:
    query = query.strip()
    if not query:
        return list_memories()[:limit]
    conn = get_db()
    # Sanitize FTS5 query terms
    clean_q = " OR ".join([f'"{term}"' for term in query.split() if term.isalnum()])
    if not clean_q:
        clean_q = f'"{query}"'
    try:
        cur = conn.execute(
            """
            SELECT m.id, m.content, m.category, m.source, m.created_at, m.updated_at, bm25(memories_fts) as rank
            FROM memories_fts f
            JOIN memories m ON f.rowid = m.id
            WHERE memories_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (clean_q, limit)
        )
        rows = [dict(r) for r in cur.fetchall()]
    except Exception:
        # Fallback to LIKE
        cur = conn.execute(
            "SELECT id, content, category, source, created_at, updated_at FROM memories WHERE content LIKE ? LIMIT ?",
            (f"%{query}%", limit)
        )
        rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

# ----------------- Conversation History Archive -----------------

def save_chat_message(conversation_id: str, role: str, content: str, title: str = None):
    if not conversation_id or not content:
        return
    ts = now_ist()
    conn = get_db()
    with conn:
        conn.execute(
            """
            INSERT INTO conversations (id, title, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                updated_at = excluded.updated_at,
                title = COALESCE(excluded.title, conversations.title)
            """,
            (conversation_id, title or content[:50], ts, ts)
        )
        conn.execute(
            "INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (conversation_id, role, content, ts)
        )
    conn.close()

def search_history(query: str, limit: int = 5) -> list:
    query = query.strip()
    if not query:
        return []
    conn = get_db()
    clean_q = " OR ".join([f'"{term}"' for term in query.split() if term.isalnum()])
    if not clean_q:
        clean_q = f'"{query}"'
    try:
        cur = conn.execute(
            """
            SELECT m.conversation_id, c.title, m.role, m.content, m.created_at, bm25(messages_fts) as rank
            FROM messages_fts f
            JOIN messages m ON f.rowid = m.id
            JOIN conversations c ON m.conversation_id = c.id
            WHERE messages_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (clean_q, limit)
        )
        results = [dict(r) for r in cur.fetchall()]
    except Exception:
        cur = conn.execute(
            """
            SELECT m.conversation_id, c.title, m.role, m.content, m.created_at
            FROM messages m
            JOIN conversations c ON m.conversation_id = c.id
            WHERE m.content LIKE ?
            ORDER BY m.id DESC
            LIMIT ?
            """,
            (f"%{query}%", limit)
        )
        results = [dict(r) for r in cur.fetchall()]
    conn.close()
    return results

def list_conversations(limit: int = 40) -> list:
    conn = get_db()
    cur = conn.execute("SELECT id, title, created_at, updated_at FROM conversations ORDER BY updated_at DESC LIMIT ?", (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def get_conversation_messages(conversation_id: str) -> list:
    conn = get_db()
    cur = conn.execute("SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY id ASC", (conversation_id,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

# ----------------- File Knowledge Library (RAG) -----------------

def chunk_text(text: str, chunk_size: int = 900, overlap: int = 150) -> list:
    """Splits long text into overlapping chunks, preserving sentence/line boundaries where possible."""
    chunks = []
    text = text.strip()
    if not text:
        return chunks
    
    start = 0
    total_len = len(text)
    while start < total_len:
        end = min(start + chunk_size, total_len)
        # Try to find paragraph break or newline
        if end < total_len:
            split_pos = text.rfind("\n", start + chunk_size // 2, end)
            if split_pos == -1:
                split_pos = text.rfind(". ", start + chunk_size // 2, end)
            if split_pos != -1:
                end = split_pos + 1
        
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= total_len:
            break
        start = max(start + 1, end - overlap)
    return chunks

def index_document(filename: str, file_bytes: bytes, file_type: str, extracted_text: str, custom_chunks: list = None) -> dict:
    """Saves document to disk, chunks content, and builds searchable FTS index."""
    doc_id = hashlib.sha256(file_bytes).hexdigest()[:16]
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    stored_path = LIBRARY_DIR / f"{doc_id}_{filename}"
    
    # Save original copy
    with open(stored_path, "wb") as f:
        f.write(file_bytes)
        
    chunks = custom_chunks or chunk_text(extracted_text)
    ts = now_ist()
    conn = get_db()
    with conn:
        # Remove old if re-indexing
        conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        conn.execute("DELETE FROM doc_chunks WHERE doc_id = ?", (doc_id,))
        
        conn.execute(
            """
            INSERT INTO documents (id, filename, filepath, file_type, file_size, char_count, chunk_count, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (doc_id, filename, str(stored_path), file_type, len(file_bytes), len(extracted_text), len(chunks), ts)
        )
        
        for idx, chunk in enumerate(chunks, 1):
            metadata = json.dumps({"filename": filename, "chunk": idx, "total_chunks": len(chunks)})
            conn.execute(
                "INSERT INTO doc_chunks (doc_id, chunk_index, content, metadata) VALUES (?, ?, ?, ?)",
                (doc_id, idx, chunk, metadata)
            )
            
    conn.close()
    return {
        "id": doc_id,
        "filename": filename,
        "file_type": file_type,
        "size": len(file_bytes),
        "char_count": len(extracted_text),
        "chunk_count": len(chunks),
        "uploaded_at": ts
    }

def list_library_documents() -> list:
    conn = get_db()
    cur = conn.execute("SELECT id, filename, file_type, file_size, char_count, chunk_count, uploaded_at FROM documents ORDER BY uploaded_at DESC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def delete_library_document(doc_id: str) -> bool:
    conn = get_db()
    with conn:
        cur = conn.execute("SELECT filepath FROM documents WHERE id = ?", (doc_id,))
        row = cur.fetchone()
        if row and row["filepath"] and os.path.exists(row["filepath"]):
            try:
                os.remove(row["filepath"])
            except Exception:
                pass
        conn.execute("DELETE FROM doc_chunks WHERE doc_id = ?", (doc_id,))
        cur = conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        deleted = cur.rowcount > 0
    conn.close()
    return deleted

def search_library(query: str, limit: int = 4) -> list:
    query = query.strip()
    if not query:
        return []
    conn = get_db()
    clean_q = " OR ".join([f'"{term}"' for term in query.split() if term.isalnum()])
    if not clean_q:
        clean_q = f'"{query}"'
    try:
        cur = conn.execute(
            """
            SELECT c.doc_id, d.filename, c.chunk_index, c.content, c.metadata, bm25(doc_chunks_fts) as rank
            FROM doc_chunks_fts f
            JOIN doc_chunks c ON f.rowid = c.id
            JOIN documents d ON c.doc_id = d.id
            WHERE doc_chunks_fts MATCH ?
            ORDER BY rank
            LIMIT ?
            """,
            (clean_q, limit)
        )
        rows = [dict(r) for r in cur.fetchall()]
    except Exception:
        cur = conn.execute(
            """
            SELECT c.doc_id, d.filename, c.chunk_index, c.content, c.metadata
            FROM doc_chunks c
            JOIN documents d ON c.doc_id = d.id
            WHERE c.content LIKE ?
            ORDER BY c.id ASC
            LIMIT ?
            """,
            (f"%{query}%", limit)
        )
        rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

# Initialize DB on load
init_db()
