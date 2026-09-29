#!/usr/bin/env python3
import ast, json, os, sys
from pathlib import Path
from urllib.parse import quote

root = Path(sys.argv[1]).resolve()
requested = json.loads(sys.stdin.read() or "[]")

def relpath(p):
    return Path(p).relative_to(root).as_posix()

def module_name(source_path):
    p = source_path[:-3] if source_path.endswith(".py") else source_path
    parts = p.split("/")
    if parts and parts[-1] == "__init__":
        parts = parts[:-1]
    return ".".join(parts)

def sid(source_path, qualified, line):
    return f"symbol:{source_path}#{quote(qualified, safe='')}@{line}"

def source_segment(text, node):
    lines = text.splitlines()
    start = max(0, getattr(node, "lineno", 1) - 1)
    end = max(start + 1, getattr(node, "end_lineno", getattr(node, "lineno", 1)))
    return "\n".join(lines[start:end])

modules = {}
for item in requested:
    p = (root / item).resolve()
    if not p.is_file() or p.suffix != ".py":
        continue
    try:
        text = p.read_text(encoding="utf-8")
        tree = ast.parse(text, filename=item)
    except (UnicodeDecodeError, SyntaxError):
        continue
    modules[module_name(item)] = {"path": item, "text": text, "tree": tree}

defs = {}
module_defs = {}
class_defs = {}
class_bases = {}
imports = {}

def params_text(node):
    try:
        return ast.unparse(node.args)
    except Exception:
        return ""

for mod, info in modules.items():
    module_defs[mod] = {}
    class_defs[mod] = {}
    imports[mod] = {}
    for node in info["tree"].body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            q = node.name
            rec = {"module": mod, "class": None, "name": node.name, "qualified": q, "node": node, "path": info["path"]}
            defs[(mod, q)] = rec
            module_defs[mod][node.name] = rec
        elif isinstance(node, ast.ClassDef):
            class_defs[mod][node.name] = {}
            class_bases[(mod, node.name)] = [ast.unparse(b) for b in node.bases]
            for child in node.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    q = f"{node.name}.{child.name}"
                    rec = {"module": mod, "class": node.name, "name": child.name, "qualified": q, "node": child, "path": info["path"]}
                    defs[(mod, q)] = rec
                    class_defs[mod][node.name][child.name] = rec
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imports[mod][alias.asname or alias.name.split(".")[0]] = {"kind": "module", "module": alias.name}
        elif isinstance(node, ast.ImportFrom):
            level = int(node.level or 0)
            base_parts = mod.split(".")[:-1]
            if level:
                base_parts = base_parts[:max(0, len(base_parts) - level + 1)]
            imported_mod = ".".join([*base_parts, node.module or ""]).strip(".")
            for alias in node.names:
                if alias.name == "*":
                    continue
                imports[mod][alias.asname or alias.name] = {"kind": "symbol", "module": imported_mod, "name": alias.name}

def class_record(mod, class_name):
    return class_defs.get(mod, {}).get(class_name)

def resolve_class_ref(mod, name):
    if name in class_defs.get(mod, {}):
        return (mod, name)
    imp = imports.get(mod, {}).get(name)
    if imp and imp["kind"] == "symbol" and imp["name"] in class_defs.get(imp["module"], {}):
        return (imp["module"], imp["name"])
    return None

def resolve_method(mod, cls, method, seen=None):
    seen = seen or set()
    key = (mod, cls)
    if key in seen:
        return None
    seen.add(key)
    direct = class_defs.get(mod, {}).get(cls, {}).get(method)
    if direct:
        return direct
    for base in class_bases.get((mod, cls), []):
        leaf = base.split(".")[-1]
        ref = resolve_class_ref(mod, leaf)
        if ref:
            found = resolve_method(ref[0], ref[1], method, seen)
            if found:
                return found
    return None

def resolve_name(mod, name):
    if name in module_defs.get(mod, {}):
        return module_defs[mod][name]
    cls = resolve_class_ref(mod, name)
    if cls:
        return resolve_method(cls[0], cls[1], "__init__")
    imp = imports.get(mod, {}).get(name)
    if imp and imp["kind"] == "symbol":
        if imp["name"] in module_defs.get(imp["module"], {}):
            return module_defs[imp["module"]][imp["name"]]
        if imp["name"] in class_defs.get(imp["module"], {}):
            return resolve_method(imp["module"], imp["name"], "__init__")
    return None

def infer_instances(rec):
    inferred = {}
    for node in ast.walk(rec["node"]):
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        value = getattr(node, "value", None)
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not isinstance(value, ast.Call) or not isinstance(value.func, ast.Name):
            continue
        cls = resolve_class_ref(rec["module"], value.func.id)
        if not cls:
            continue
        for target in targets:
            if isinstance(target, ast.Name):
                inferred[target.id] = cls
    return inferred

def resolve_attribute(rec, node, inferred):
    attr = node.attr
    base = node.value
    mod = rec["module"]
    if isinstance(base, ast.Name):
        if base.id in ("self", "cls") and rec["class"]:
            return resolve_method(mod, rec["class"], attr)
        if base.id in inferred:
            cls_mod, cls = inferred[base.id]
            return resolve_method(cls_mod, cls, attr)
        cls_ref = resolve_class_ref(mod, base.id)
        if cls_ref:
            return resolve_method(cls_ref[0], cls_ref[1], attr)
        imp = imports.get(mod, {}).get(base.id)
        if imp and imp["kind"] == "module":
            return module_defs.get(imp["module"], {}).get(attr)
    return None

entry_targets = set()
for mod, info in modules.items():
    for node in info["tree"].body:
        if not isinstance(node, ast.If):
            continue
        try:
            test = ast.unparse(node.test).replace(" ", "")
        except Exception:
            test = ""
        if test not in {"__name__=='__main__'", '"__main__"==__name__', "'__main__'==__name__"}:
            continue
        for child in ast.walk(node):
            if isinstance(child, ast.Call) and isinstance(child.func, ast.Name):
                target = resolve_name(mod, child.func.id)
                if target:
                    entry_targets.add((target["module"], target["qualified"]))

symbols = []
for rec in defs.values():
    node = rec["node"]
    text = modules[rec["module"]]["text"]
    inferred = infer_instances(rec)
    refs = []
    seen_refs = set()
    for call in [n for n in ast.walk(node) if isinstance(n, ast.Call)]:
        target = None
        display = ""
        if isinstance(call.func, ast.Name):
            display = call.func.id
            target = resolve_name(rec["module"], display)
        elif isinstance(call.func, ast.Attribute):
            try:
                display = ast.unparse(call.func)
            except Exception:
                display = call.func.attr
            target = resolve_attribute(rec, call.func, inferred)
        if target:
            target_id = sid(target["path"], target["qualified"], target["node"].lineno)
            key = ("calls", target_id)
            if key not in seen_refs:
                refs.append({"name": display or target["qualified"], "simpleName": target["name"], "relation": "calls", "targetSymbolId": target_id, "resolution": "python_ast", "line": getattr(call, "lineno", 0), "endLine": getattr(call, "end_lineno", getattr(call, "lineno", 0))})
                seen_refs.add(key)
        elif display:
            key = ("calls", display)
            if key not in seen_refs:
                refs.append({"name": display, "simpleName": display.split(".")[-1], "relation": "calls", "resolution": "unresolved", "line": getattr(call, "lineno", 0), "endLine": getattr(call, "end_lineno", getattr(call, "lineno", 0))})
                seen_refs.add(key)

    signature = ("async " if isinstance(node, ast.AsyncFunctionDef) else "") + f"def {rec['qualified']}({params_text(node)}):"
    regions = []
    region_index_ref = [0]

    def add_regions(statements, parent_region_id=None):
        for child in statements:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            region_index_ref[0] += 1
            region_id = f"{sid(rec['path'], rec['qualified'], node.lineno)}:region:{region_index_ref[0]}"
            kind = type(child).__name__.lower()
            regions.append({
                "id": region_id,
                "kind": kind,
                "startLine": getattr(child, "lineno", node.lineno),
                "endLine": getattr(child, "end_lineno", getattr(child, "lineno", node.lineno)),
                "body": source_segment(text, child),
                "parentRegionId": parent_region_id
            })
            nested_lists = []
            for field in ("body", "orelse", "finalbody"):
                value = getattr(child, field, None)
                if isinstance(value, list) and value:
                    nested_lists.append(value)
            for handler in getattr(child, "handlers", []) or []:
                if getattr(handler, "body", None):
                    nested_lists.append(handler.body)
            for case in getattr(child, "cases", []) or []:
                if getattr(case, "body", None):
                    nested_lists.append(case.body)
            for nested in nested_lists:
                add_regions(nested, region_id)

    add_regions(node.body)

    symbols.append({
        "id": sid(rec["path"], rec["qualified"], node.lineno),
        "name": rec["qualified"],
        "simpleName": rec["name"],
        "symbolKind": "method" if rec["class"] else "function",
        "signature": signature,
        "sourcePath": rec["path"],
        "startLine": node.lineno,
        "endLine": getattr(node, "end_lineno", node.lineno),
        "body": source_segment(text, node),
        "references": refs,
        "language": "python",
        "className": rec["class"],
        "moduleName": rec["module"],
        "entryPoint": (rec["module"], rec["qualified"]) in entry_targets or (rec["class"] is None and rec["name"] == "main"),
        "regions": regions
    })

print(json.dumps({"version": 1, "symbols": symbols}, ensure_ascii=False))
