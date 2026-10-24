#!/usr/bin/env python3
"""Summarize synthetic heap snapshots without publishing strings or credentials.

Counts are shallow sizes and reachability, not a computed dominator retained-size
estimate. Snapshotting forces collection; forced-GC pauses must be excluded from
request-latency claims. Raw snapshots belong in a private transient directory.
"""
import argparse, collections, hashlib, json, pathlib

p = argparse.ArgumentParser()
p.add_argument("snapshots", nargs="+")
p.add_argument("--output", required=True)
a = p.parse_args()
interesting = {"IncomingMessage", "ServerResponse", "WebSocket", "WebSocketServer", "Socket", "Client", "Pool", "BoundPool", "Query", "Timeout", "TokenBucket", "Promise", "ArrayBuffer", "Uint8Array", "Buffer", "AbortController", "AbortSignal", "Request", "Response", "Headers", "Readable", "Writable"}
reports = []
previous_ids = {}
for filename in a.snapshots:
    file = pathlib.Path(filename)
    raw = file.read_bytes()
    data = json.loads(raw)
    fields = data["snapshot"]["meta"]["node_fields"]
    indexes = {v: fields.index(v) for v in ["type", "name", "id", "self_size"]}
    types = data["snapshot"]["meta"]["node_types"][indexes["type"]]
    nodes, strings, width = data["nodes"], data["strings"], len(fields)
    totals, objects, ids = collections.defaultdict(lambda: [0, 0]), collections.defaultdict(lambda: [0, 0]), collections.defaultdict(set)
    for i in range(0, len(nodes), width):
        kind = types[nodes[i + indexes["type"]]]
        name = strings[nodes[i + indexes["name"]]]
        size = nodes[i + indexes["self_size"]]
        totals[kind][0] += 1; totals[kind][1] += size
        if kind == "object":
            # Constructor names only; string values and property names never leave the private file.
            if name in interesting:
                objects[name][0] += 1; objects[name][1] += size
                ids[name].add(nodes[i + indexes["id"]])
    reports.append({"checkpoint": file.stem, "sha256": hashlib.sha256(raw).hexdigest(), "snapshotBytes": len(raw),
        "byNodeType": {k: {"count": v[0], "shallowBytes": v[1]} for k, v in totals.items()},
        "selectedConstructors": {k: {"count": v[0], "shallowBytes": v[1],
            "survivingFromPrevious": len(ids[k] & previous_ids.get(k, set())),
            "newSincePrevious": len(ids[k] - previous_ids.get(k, set()))} for k, v in sorted(objects.items())}})
    previous_ids = ids
pathlib.Path(a.output).write_text(json.dumps({"method": "V8 heap node census after forced major GC; selected constructor identity comparison; no dominator retained-byte claim", "snapshots": reports}, indent=2) + "\n")
print(json.dumps({"snapshots": len(reports), "output": a.output}))
