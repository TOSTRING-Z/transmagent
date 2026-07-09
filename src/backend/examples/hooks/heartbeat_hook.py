#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime
from pathlib import Path


def load_payload() -> dict:
    raw = os.environ.get("TRANSMAGENT_HOOK_PAYLOAD", "{}")
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def append_log(output_dir: Path, event_name: str, payload: dict, response: dict) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    log_path = output_dir / f"{event_name}.jsonl"
    record = {
        "received_at": datetime.utcnow().isoformat() + "Z",
        "event": event_name,
        "payload": payload,
        "response": response,
    }
    with log_path.open("a", encoding="utf-8") as fp:
        fp.write(json.dumps(record, ensure_ascii=False) + "\n")


def build_heartbeat_before_response(payload: dict) -> dict:
    trigger = payload.get("payload") or {}
    triggered_at = trigger.get("triggered_at", "unknown")

    return {
        "env": {
            "last_heartbeat_triggered_at": str(triggered_at),
            "last_heartbeat_source": "examples/hooks/heartbeat_hook.py",
        },
        "tasks": [
            {
                "task": "Heartbeat hook injected task",
                "task_type": "standard",
                "subtasks": [
                    f"Review scheduler heartbeat triggered at {triggered_at}",
                    "Confirm hook-based task injection is working",
                ],
                "update_mode": "append",
            }
        ],
    }


def build_heartbeat_after_response(payload: dict) -> dict:
    trigger = payload.get("payload") or {}
    status = trigger.get("status", "unknown")

    return {
        "env": {
            "last_heartbeat_status": str(status),
        }
    }


def main() -> int:
    event_name = os.environ.get("TRANSMAGENT_HOOK_EVENT", "unknown")
    payload = load_payload()
    output_dir = Path(os.environ.get("TRANSMAGENT_HOOK_OUTPUT_DIR", "./hook_logs"))

    response = None
    if event_name == "heartbeat_before":
        response = build_heartbeat_before_response(payload)
    elif event_name == "heartbeat_after":
        response = build_heartbeat_after_response(payload)

    append_log(output_dir, event_name, payload, response)

    if response is not None:
        json.dump(response, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
    else:
        print(f"hook captured: {event_name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
