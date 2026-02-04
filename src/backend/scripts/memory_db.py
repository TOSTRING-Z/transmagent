import sqlite3
import sys
import json
import os
import numpy as np

def cosine_similarity(v1, v2):
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return np.dot(v1, v2) / (norm1 * norm2)

def init_db(db_path):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS memories
                 (id TEXT PRIMARY KEY, content TEXT, embedding TEXT, timestamp REAL)''')
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Database initialized"}

def add_memory(db_path, memory_id, content, embedding, timestamp):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    # embedding is stored as a JSON string
    c.execute("INSERT OR REPLACE INTO memories VALUES (?, ?, ?, ?)", 
              (memory_id, content, json.dumps(embedding), timestamp))
    conn.commit()
    conn.close()
    return {"status": "success", "message": "Memory added"}

def query_memory(db_path, query_embedding, top_k=5):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT id, content, embedding, timestamp FROM memories")
    rows = c.fetchall()
    conn.close()

    results = []
    query_vec = np.array(query_embedding)
    
    for row in rows:
        mem_id, content, emb_str, ts = row
        mem_vec = np.array(json.loads(emb_str))
        score = cosine_similarity(query_vec, mem_vec)
        results.append({
            "id": mem_id,
            "content": content,
            "score": float(score),
            "timestamp": ts
        })
    
    # Sort by score descending
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:top_k]

if __name__ == "__main__":
    try:
        # Read JSON command from stdin
        input_data = sys.stdin.read()
        if not input_data:
             sys.exit(0)
             
        command = json.loads(input_data)
        action = command.get("action")
        db_path = command.get("db_path")
        
        if action == "init":
            result = init_db(db_path)
            print(json.dumps(result))
            
        elif action == "add":
            result = add_memory(
                db_path,
                command["id"],
                command["content"],
                command["embedding"],
                command["timestamp"]
            )
            print(json.dumps(result))
            
        elif action == "query":
            result = query_memory(
                db_path,
                command["embedding"],
                command.get("top_k", 5)
            )
            print(json.dumps(result))
            
        else:
            print(json.dumps({"status": "error", "message": "Unknown action"}))
            
    except Exception as e:
        print(json.dumps({"status": "error", "message": str(e)}))