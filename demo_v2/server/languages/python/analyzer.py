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
external_symbols = []

def exported_names(tree):
    out = set()
    for node in tree.body:
        if not isinstance(node, (ast.Assign, ast.AnnAssign)):
            continue
        targets = node.targets if isinstance(node, ast.Assign) else [node.target]
        if not any(isinstance(target, ast.Name) and target.id == "__all__" for target in targets):
            continue
        value = getattr(node, "value", None)
        if isinstance(value, (ast.List, ast.Tuple, ast.Set)):
            for item in value.elts:
                if isinstance(item, ast.Constant) and isinstance(item.value, str):
                    out.add(item.value)
    return out

def external_symbol_id(source_path, local_name, imported_module, imported_name, line):
    qualified = ".".join([part for part in [imported_module, imported_name] if part])
    return f"external:{source_path}#{quote(local_name, safe='')}@{line}:{quote(qualified, safe='')}"

def params_text(node):
    try:
        return ast.unparse(node.args)
    except Exception:
        return ""

for mod, info in modules.items():
    module_defs[mod] = {}
    class_defs[mod] = {}
    imports[mod] = {}
    module_exports = exported_names(info["tree"])
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
                local_name = alias.asname or alias.name.split(".")[0]
                imports[mod][local_name] = {"kind": "module", "module": alias.name, "line": getattr(node, "lineno", 0)}
                if alias.name not in modules:
                    external_symbols.append({
                        "id": external_symbol_id(info["path"], local_name, alias.name, "", getattr(node, "lineno", 0)),
                        "localName": local_name,
                        "name": alias.name,
                        "simpleName": local_name,
                        "importModule": alias.name,
                        "importName": "",
                        "qualifiedName": alias.name,
                        "sourcePath": info["path"],
                        "moduleName": mod,
                        "startLine": getattr(node, "lineno", 0),
                        "endLine": getattr(node, "end_lineno", getattr(node, "lineno", 0)),
                        "reExported": local_name in module_exports,
                        "kind": "external-module"
                    })
        elif isinstance(node, ast.ImportFrom):
            level = int(node.level or 0)
            if level == 0:
                imported_mod = str(node.module or "").strip(".")
            else:
                package_parts = mod.split(".")[:-1]
                base_parts = package_parts[:max(0, len(package_parts) - level + 1)]
                imported_mod = ".".join([*base_parts, node.module or ""]).strip(".")
            for alias in node.names:
                if alias.name == "*":
                    continue
                local_name = alias.asname or alias.name
                imports[mod][local_name] = {"kind": "symbol", "module": imported_mod, "name": alias.name, "line": getattr(node, "lineno", 0)}
                internal_symbol = (
                    alias.name in module_defs.get(imported_mod, {}) or
                    alias.name in class_defs.get(imported_mod, {})
                )
                if imported_mod not in modules and not internal_symbol:
                    external_symbols.append({
                        "id": external_symbol_id(info["path"], local_name, imported_mod, alias.name, getattr(node, "lineno", 0)),
                        "localName": local_name,
                        "name": local_name,
                        "simpleName": local_name,
                        "importModule": imported_mod,
                        "importName": alias.name,
                        "qualifiedName": ".".join([part for part in [imported_mod, alias.name] if part]),
                        "sourcePath": info["path"],
                        "moduleName": mod,
                        "startLine": getattr(node, "lineno", 0),
                        "endLine": getattr(node, "end_lineno", getattr(node, "lineno", 0)),
                        "reExported": local_name in module_exports,
                        "kind": "external-symbol"
                    })

external_export_by_module_name = {}
for item in external_symbols:
    if item.get("reExported") and item.get("moduleName") and item.get("localName"):
        external_export_by_module_name[(item["moduleName"], item["localName"])] = item

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

def external_call_info(mod, call, display):
    imp = None
    qualified = display
    imported_module = ""
    imported_name = ""
    target_external_id = ""
    via_module = ""
    if isinstance(call.func, ast.Name):
        imp = imports.get(mod, {}).get(call.func.id)
        if imp:
            if imp["kind"] == "symbol":
                imported_module = imp["module"]
                imported_name = imp["name"]
                reexport = external_export_by_module_name.get((imported_module, imported_name))
                if reexport:
                    via_module = imported_module
                    imported_module = reexport.get("importModule", imported_module)
                    imported_name = reexport.get("importName", imported_name)
                    qualified = reexport.get("qualifiedName") or ".".join([part for part in [imported_module, imported_name] if part])
                    target_external_id = reexport.get("id", "")
                else:
                    qualified = ".".join([part for part in [imported_module, imported_name] if part])
            elif imp["kind"] == "module":
                imported_module = imp["module"]
                qualified = imported_module
    elif isinstance(call.func, ast.Attribute) and isinstance(call.func.value, ast.Name):
        imp = imports.get(mod, {}).get(call.func.value.id)
        if imp and imp["kind"] == "module":
            imported_module = imp["module"]
            imported_name = call.func.attr
            qualified = f"{imported_module}.{call.func.attr}"
    if not imp:
        return None
    try:
        call_text = ast.unparse(call)
    except Exception:
        call_text = display
    keywords = [kw.arg for kw in call.keywords if kw.arg]
    return {
        "external": True,
        "importModule": imported_module,
        "importName": imported_name,
        "qualifiedName": qualified,
        "callText": call_text,
        "keywordArgs": keywords,
        "targetExternalId": target_external_id,
        "viaModule": via_module
    }

def iter_scope_calls(node):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        return
    if isinstance(node, ast.ClassDef):
        for deco in node.decorator_list:
            yield from iter_scope_calls(deco)
        for base in node.bases:
            yield from iter_scope_calls(base)
        for keyword in node.keywords:
            yield from iter_scope_calls(keyword.value)
        for child in node.body:
            yield from iter_scope_calls(child)
        return
    if isinstance(node, ast.Call):
        yield node
    for child in ast.iter_child_nodes(node):
        yield from iter_scope_calls(child)

for mod, info in modules.items():
    seen_external_scope_calls = set()
    for top in info["tree"].body:
        if isinstance(top, (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        scope_name = top.name if isinstance(top, ast.ClassDef) else "<module>"
        for call in iter_scope_calls(top):
            display = ""
            if isinstance(call.func, ast.Name):
                display = call.func.id
                target = resolve_name(mod, display)
            elif isinstance(call.func, ast.Attribute):
                try:
                    display = ast.unparse(call.func)
                except Exception:
                    display = call.func.attr
                target = None
            else:
                target = None
            if target or not display:
                continue
            external = external_call_info(mod, call, display)
            if not external:
                continue
            line = getattr(call, "lineno", 0)
            key = (info["path"], scope_name, line, external["qualifiedName"])
            if key in seen_external_scope_calls:
                continue
            seen_external_scope_calls.add(key)
            external_symbols.append({
                "id": f"external-call:{info['path']}#{quote(scope_name, safe='')}@{line}:{quote(external['qualifiedName'], safe='')}",
                "localName": display,
                "name": external["qualifiedName"],
                "simpleName": display.split(".")[-1],
                "importModule": external["importModule"],
                "importName": external["importName"],
                "qualifiedName": external["qualifiedName"],
                "sourcePath": info["path"],
                "startLine": line,
                "endLine": getattr(call, "end_lineno", line),
                "reExported": False,
                "kind": "external-call",
                "scopeKind": "class-body" if isinstance(top, ast.ClassDef) else "module-body",
                "scopeName": scope_name,
                "callText": external["callText"],
                "keywordArgs": external["keywordArgs"],
                "targetExternalId": external.get("targetExternalId", ""),
                "viaModule": external.get("viaModule", "")
            })

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


def construct_name(node):
    try:
        if isinstance(node, ast.Call):
            return ast.unparse(node.func)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            return node.name
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            return ast.unparse(node)
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
            target = node.targets[0] if isinstance(node, ast.Assign) and node.targets else getattr(node, "target", None)
            return ast.unparse(target) if target is not None else ""
        if isinstance(node, ast.Raise):
            return ast.unparse(node.exc) if node.exc is not None else "raise"
    except Exception:
        return ""
    return ""

def construct_type(node):
    if isinstance(node, ast.ClassDef): return "class"
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)): return "function"
    if isinstance(node, (ast.For, ast.AsyncFor, ast.While)): return "loop"
    if isinstance(node, ast.If): return "condition"
    if isinstance(node, ast.Call): return "call"
    if isinstance(node, (ast.Import, ast.ImportFrom)): return "import"
    if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)): return "assignment"
    if isinstance(node, ast.Return): return "return"
    if isinstance(node, ast.Raise): return "exception"
    return ""

constructs = []
for mod, info in modules.items():
    text = info["text"]
    scope_stack = []

    class ConstructVisitor(ast.NodeVisitor):
        def add(self, node, ctype, name=""):
            parent_function = next((scope for scope in reversed(scope_stack) if scope["kind"] == "function"), None)
            parent_class = next((scope for scope in reversed(scope_stack) if scope["kind"] == "class"), None)
            snippet = source_segment(text, node)
            try:
                canonical_snippet = ast.unparse(node)
            except Exception:
                canonical_snippet = snippet
            record = {
                "constructType": ctype,
                "name": name or construct_name(node),
                "sourcePath": info["path"],
                "startLine": getattr(node, "lineno", 0),
                "endLine": getattr(node, "end_lineno", getattr(node, "lineno", 0)),
                "snippet": snippet,
                "canonicalSnippet": canonical_snippet,
                "parentFunction": parent_function["name"] if parent_function else "",
                "parentClass": parent_class["name"] if parent_class else "",
                "moduleName": mod
            }
            if isinstance(node, ast.Call):
                external = external_call_info(mod, node, record["name"])
                if external:
                    record["external"] = True
                    record["module"] = external.get("importModule", "")
                    record["qualifiedName"] = external.get("qualifiedName", "")
                    record["keywordArgs"] = external.get("keywordArgs", [])
                else:
                    record["external"] = False
                    record["keywordArgs"] = [kw.arg for kw in node.keywords if kw.arg]
            constructs.append(record)

        def visit_ClassDef(self, node):
            self.add(node, "class", node.name)
            for deco in node.decorator_list:
                self.add(deco, "decorator", ast.unparse(deco) if hasattr(ast, "unparse") else "")
            scope_stack.append({"kind": "class", "name": node.name})
            self.generic_visit(node)
            scope_stack.pop()

        def visit_FunctionDef(self, node):
            self.add(node, "function", node.name)
            for deco in node.decorator_list:
                self.add(deco, "decorator", ast.unparse(deco) if hasattr(ast, "unparse") else "")
            scope_stack.append({"kind": "function", "name": node.name})
            self.generic_visit(node)
            scope_stack.pop()

        def visit_AsyncFunctionDef(self, node):
            self.visit_FunctionDef(node)

        def generic_visit(self, node):
            ctype = construct_type(node)
            if ctype and not isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                self.add(node, ctype)
            super().generic_visit(node)

    ConstructVisitor().visit(info["tree"])

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
            external = external_call_info(rec["module"], call, display)
            line = getattr(call, "lineno", 0)
            key = ("calls", display, line)
            if key not in seen_refs:
                ref = {"name": display, "simpleName": display.split(".")[-1], "relation": "calls", "resolution": "external_import" if external else "unresolved", "line": line, "endLine": getattr(call, "end_lineno", line)}
                if external:
                    ref.update(external)
                refs.append(ref)
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
        "executable": True,
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

print(json.dumps({"version": 4, "symbols": symbols, "externalSymbols": external_symbols, "constructs": constructs}, ensure_ascii=False))
