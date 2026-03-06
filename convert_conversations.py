import json
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
source = root / "chats" / "conversations.json"
target = root / "chats" / "merged_chats.json"

if not source.exists():
    raise SystemExit("conversations.json not found at" + str(source))

with source.open("r", encoding="utf-8") as f:
    conversations = json.load(f)

converted = []

for index, conv in enumerate(conversations, start=1):
    mapping = conv.get("mapping") or {}
    messages = []

    for node in mapping.values():
        message = node.get("message")
        if not message:
            continue

        author = message.get("author") or {}
        role = author.get("role")
        if role not in {"user", "assistant"}:
            continue

        content = message.get("content") or {}
        parts = content.get("parts")
        if not parts:
            continue

        text_chunks = []
        for part in parts:
            if isinstance(part, str):
                cleaned = part.strip()
                if cleaned:
                    text_chunks.append(cleaned)
            elif isinstance(part, dict):
                # Some exports wrap text in dict structures
                if part.get("content_type") == "text":
                    text = part.get("text") or part.get("value") or ""
                    text = text.strip()
                    if text:
                        text_chunks.append(text)
            else:
                continue

        if not text_chunks:
            continue

        text = "\n\n".join(text_chunks)
        timestamp = message.get("create_time")
        if timestamp is None:
            parent_ts = node.get("create_time")
            if isinstance(parent_ts, (int, float)):
                timestamp = parent_ts

        messages.append({
            "role": role,
            "content": text,
            "_ts": float(timestamp) if isinstance(timestamp, (int, float)) else None
        })

    if not messages:
        continue

    # Preserve chronological order; fallback to append order when timestamp missing
    messages.sort(key=lambda item: (item["_ts"] is None, item["_ts"] if item["_ts"] is not None else 0.0))
    for i, msg in enumerate(messages):
        msg.pop("_ts", None)

    created_at = conv.get("create_time")
    created_iso = None
    if isinstance(created_at, (int, float)):
        created_iso = datetime.fromtimestamp(created_at, tz=timezone.utc).isoformat()

    converted.append({
        "id": conv.get("conversation_id") or conv.get("id") or f"conversation-{index:03d}",
        "title": conv.get("title") or f"Conversation {index}",
        "created_at": created_iso,
        "messages": messages
    })

with target.open("w", encoding="utf-8") as f:
    json.dump(converted, f, ensure_ascii=False, indent=2)

print(f"Converted {len(converted)} conversations to {target.name}")
