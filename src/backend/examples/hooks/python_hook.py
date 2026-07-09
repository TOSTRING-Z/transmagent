#!/usr/bin/env python3
import json
import os
from datetime import datetime
from pathlib import Path


def main() -> int:
    event_name = os.environ.get("TRANSMAGENT_HOOK_EVENT", "unknown")
    payload_raw = os.environ.get("TRANSMAGENT_HOOK_PAYLOAD", "{}")
    payload = json.loads(payload_raw)

    output_dir = Path(os.environ.get("TRANSMAGENT_HOOK_OUTPUT_DIR", "./hook_logs"))
    output_dir.mkdir(parents=True, exist_ok=True)

    log_path = output_dir / f"{event_name}.jsonl"
    record = {
        "received_at": datetime.utcnow().isoformat() + "Z",
        "event": event_name,
        "payload": payload,
    }

    with log_path.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(record, ensure_ascii=False) + "\n")

    print(f"hook captured: {event_name} -> {log_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
