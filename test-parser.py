import sys, json

raw = sys.stdin.read()

if "<html" in raw.lower() and "easypanel" in raw.lower():
    print("RESULT|502_TIMEOUT|0|0|0|0|0|false")
    sys.exit()

try:
    d = json.loads(raw)
except:
    print("RESULT|PARSE_ERROR|0|0|0|0|0|false")
    sys.exit()

if not d.get("success"):
    code = "?"
    if isinstance(d.get("data"), dict):
        code = d["data"].get("code", "?")
    elif isinstance(d.get("code"), str):
        code = d["code"]
    err = d.get("error", "")
    print(f"RESULT|FAIL:{code}|{err[:40]}|0|0|0|0|false")
    sys.exit()

m = d["data"]["metadata"]
j = d["data"].get("json")
items = j if isinstance(j, list) else []
if isinstance(j, dict):
    for v in j.values():
        if isinstance(v, list) and len(v) > 0:
            items = v
            break

wp = len([p for p in items if p.get("price")])
eng = str(m.get("engine", "?"))[:20]
pages = m.get("pagesScraped", 0)
elapsed = m.get("elapsed", 0)
cached = m.get("engineCached", False)
tokens = m.get("tokensUsed", 0)

print(f"RESULT|OK|{eng}|pages:{pages}|products:{len(items)}|with_price:{wp}|{elapsed}ms|cached:{cached}|tokens:{tokens}")
for p in items[:3]:
    name = str(p.get("name", "?"))[:50]
    price = p.get("price", "null")
    print(f"  > {name} | ${price}")
if len(items) > 3:
    print(f"  ... ({len(items)} total)")
