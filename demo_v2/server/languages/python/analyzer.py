#!/usr/bin/env python3
import ast, json, os, sys
from pathlib import Path
from urllib.parse import quote

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

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

def source_span(text, start_line, end_line):
    lines = text.splitlines()
    start = max(0, int(start_line or 1) - 1)
    end = max(start + 1, int(end_line or start_line or 1))
    return "\n".join(lines[start:end])

def build_regions(statements, text, id_prefix, fallback_line=1):
    \"\"\"Build semantic regions from both control-flow blocks and straight-line code.

    Consecutive ordinary statements become a single `block` region. Control-flow
    constructs remain explicit regions and recursively own regions for the
    statements inside them. Nested function/class definitions are separate
    symbols and therefore terminate the current straight-line block.
    \"\"\"
    regions = []
    region_index = [0]
    region_types = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith)
    if hasattr(ast, "Match"):
        region_types = region_types + (ast.Match,)

    def next_region(kind, start_line, end_line, parent_region_id):
        region_index[0] += 1
        region_id = f"{id_prefix}:region:{region_index[0]}"
        regions.append({
            "id": region_id,
            "kind": kind,
            "startLine": int(start_line or fallback_line),
            "endLine": int(end_line or start_line or fallback_line),
            "body": source_span(text, start_line or fallback_line, end_line or start_line or fallback_line),
            "parentRegionId": parent_region_id,
            "references": []
        })
        return region_id

    def is_docstring_statement(statement):
        return (
            isinstance(statement, ast.Expr) and
            isinstance(getattr(statement, "value", None), ast.Constant) and
            isinstance(statement.value.value, str)
        )

    def walk(statement_list, parent_region_id=None):
        straight = []

        def flush_straight():
            nonlocal straight
            meaningful = [item for item in straight if not is_docstring_statement(item)]
            straight = []
            if not meaningful:
                return
            start_line = getattr(meaningful[0], "lineno", fallback_line)
            end_line = getattr(meaningful[-1], "end_lineno", getattr(meaningful[-1], "lineno", start_line))
            next_region("region", start_line, end_line, parent_region_id)

        for child in statement_list:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                flush_straight()
                continue

            if isinstance(child, region_types):
                flush_straight()
                start_line = getattr(child, "lineno", fallback_line)
                end_line = getattr(child, "end_lineno", start_line)
                region_id = next_region(type(child).__name__.lower(), start_line, end_line, parent_region_id)

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
                    walk(nested, region_id)
                continue

            straight.append(child)

        flush_straight()

    walk(statements)
    return regions

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


def fact_type(node):
    if isinstance(node, ast.ClassDef): return "class"
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)): return "function"
    if isinstance(node, ast.arg): return "input_param"
    if isinstance(node, (ast.Import, ast.ImportFrom)): return "import"
    if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)): return "assignment"
    if isinstance(node, ast.Call): return "call"
    if isinstance(node, ast.Return): return "return"
    if isinstance(node, ast.Raise): return "exception"
    if isinstance(node, ast.If): return "if"
    if isinstance(node, (ast.For, ast.AsyncFor)): return "for"
    if isinstance(node, ast.While): return "while"
    if isinstance(node, ast.Try): return "try"
    if isinstance(node, ast.ExceptHandler): return "except"
    if isinstance(node, (ast.With, ast.AsyncWith)): return "with"
    if isinstance(node, ast.Assert): return "assert"
    if hasattr(ast, "Match") and isinstance(node, ast.Match): return "match"
    if hasattr(ast, "match_case") and isinstance(node, ast.match_case): return "case"
    if isinstance(node, ast.Break): return "break"
    if isinstance(node, ast.Continue): return "continue"
    if isinstance(node, ast.Pass): return "pass"
    if isinstance(node, ast.Global): return "global"
    if isinstance(node, ast.Nonlocal): return "nonlocal"
    if isinstance(node, ast.Delete): return "delete"
    if isinstance(node, ast.Await): return "await"
    if isinstance(node, (ast.Yield, ast.YieldFrom)): return "yield"
    if isinstance(node, (ast.Lambda, ast.BinOp, ast.BoolOp, ast.Compare, ast.IfExp,
                         ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
        return "expression"
    return ""

def fact_name(node, ctype, owner_name="", region_number=0):
    try:
        if ctype in ("function", "class"):
            return node.name
        if ctype == "input_param":
            return node.arg
        if ctype == "call":
            return ast.unparse(node.func)
        if ctype == "assignment":
            target = node.targets[0] if isinstance(node, ast.Assign) and node.targets else getattr(node, "target", None)
            return ast.unparse(target) if target is not None else ""
        if ctype == "import":
            return ast.unparse(node)
        if ctype == "exception":
            exc = getattr(node, "exc", None)
            if isinstance(exc, ast.Call):
                return ast.unparse(exc.func)
            return ast.unparse(exc) if exc is not None else "raise"
        if ctype == "except":
            exc = getattr(node, "type", None)
            return ast.unparse(exc) if exc is not None else "except"
        if ctype in ("if", "for", "while", "try", "with", "match", "case"):
            base = owner_name or "module"
            return f"{base}_region_{region_number}"
        if ctype == "return":
            value = getattr(node, "value", None)
            return ast.unparse(value) if value is not None else "return"
        if ctype == "assert":
            return ast.unparse(node.test)
        if ctype in ("global", "nonlocal"):
            return ",".join(node.names)
        if ctype == "delete":
            return ",".join(ast.unparse(target) for target in node.targets)
        if ctype in ("expression", "await", "yield"):
            return ast.unparse(node)
        return ctype
    except Exception:
        return ctype

def node_lines(node, fallback=0):
    start = int(getattr(node, "lineno", fallback) or fallback or 0)
    end = int(getattr(node, "end_lineno", start) or start)
    if hasattr(ast, "match_case") and isinstance(node, ast.match_case):
        pattern = getattr(node, "pattern", None)
        if pattern is not None:
            start = int(getattr(pattern, "lineno", start) or start)
            end = max(end, int(getattr(pattern, "end_lineno", start) or start))
        body = getattr(node, "body", None) or []
        if body:
            end = max(end, int(getattr(body[-1], "end_lineno", getattr(body[-1], "lineno", end)) or end))
    return start, end

def build_code_facts(mod, info):
    tree = info["tree"]
    source_path = info["path"]
    parents = {}
    ordered_nodes = []

    def walk(node, parent=None):
        if parent is not None:
            parents[node] = parent
        ordered_nodes.append(node)
        for child in ast.iter_child_nodes(node):
            walk(child, node)

    walk(tree)

    selected = []
    selected_set = set()
    region_counts = {}

    def owner_for(node):
        cur = parents.get(node)
        while cur is not None:
            if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                return cur.name
            cur = parents.get(cur)
        return ""

    for ordinal, node in enumerate(ordered_nodes, start=1):
        ctype = fact_type(node)
        if not ctype:
            continue
        start, end = node_lines(node)
        if start <= 0:
            continue
        owner = owner_for(node)
        region_number = 0
        if ctype in ("if", "for", "while", "try", "with", "match", "case"):
            region_key = owner or "<module>"
            region_counts[region_key] = region_counts.get(region_key, 0) + 1
            region_number = region_counts[region_key]
        name = fact_name(node, ctype, owner, region_number)
        fact_id = f"{source_path}:{ordinal}:{start}:{end}:{ctype}"
        selected.append({
            "_node": node,
            "factId": fact_id,
            "ordinal": ordinal,
            "sourcePath": source_path,
            "startLine": start,
            "endLine": end,
            "type": ctype,
            "name": name,
            "parentFactId": "",
            "childFactIds": []
        })
        selected_set.add(node)

    by_node = {row["_node"]: row for row in selected}

    # First establish the ordinary AST containment relation for all concrete
    # constructs. Synthetic region rows below only re-parent the top-level
    # constructs that fall inside a straight-line statement group.
    for row in selected:
        node = row["_node"]
        cur = parents.get(node)
        while cur is not None and cur not in selected_set:
            cur = parents.get(cur)
        if cur is not None:
            row["parentFactId"] = by_node[cur]["factId"]

    structured_statements = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith)
    if hasattr(ast, "Match"):
        structured_statements = structured_statements + (ast.Match,)

    synthetic_regions = []
    synthetic_count = 0

    def container_fact_id(container_node):
        row = by_node.get(container_node)
        return row["factId"] if row is not None else ""

    def selected_descendants(statement):
        nodes = set()
        stack = [statement]
        while stack:
            current = stack.pop()
            if current in selected_set:
                nodes.add(current)
            for child in ast.iter_child_nodes(current):
                if child is not statement and isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                    continue
                stack.append(child)
        return nodes

    def add_straight_region(statement_group, container_node):
        nonlocal synthetic_count
        if not statement_group:
            return
        meaningful = [
            statement for statement in statement_group
            if not (
                isinstance(statement, ast.Expr) and
                isinstance(getattr(statement, "value", None), ast.Constant) and
                isinstance(statement.value.value, str)
            )
        ]
        if not meaningful:
            return

        synthetic_count += 1
        start = int(getattr(meaningful[0], "lineno", 0) or 0)
        end = int(getattr(meaningful[-1], "end_lineno", getattr(meaningful[-1], "lineno", start)) or start)
        if start <= 0:
            return

        container = container_fact_id(container_node)
        if isinstance(container_node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            scope_name = getattr(container_node, "name", "scope")
            region_name = f"{source_path}#{scope_name}#region_{synthetic_count}"
        else:
            owner = owner_for(meaningful[0])
            if owner:
                region_name = f"{source_path}#{owner}#region_{synthetic_count}"
            else:
                region_name = f"{source_path}#region_{synthetic_count}"

        first_ordinal = min(
            (by_node[node]["ordinal"] for statement in meaningful for node in selected_descendants(statement) if node in by_node),
            default=len(ordered_nodes) + synthetic_count
        )
        fact_id = f"{source_path}:region:{synthetic_count}:{start}:{end}"
        region_row = {
            "_node": None,
            "factId": fact_id,
            "ordinal": float(first_ordinal) - 0.25,
            "sourcePath": source_path,
            "startLine": start,
            "endLine": end,
            "type": "region",
            "name": region_name,
            "parentFactId": container,
            "childFactIds": []
        }
        synthetic_regions.append(region_row)

        inside = set()
        for statement in meaningful:
            inside.update(selected_descendants(statement))

        # Only roots of the grouped statements move under the region. Their
        # existing descendants (for example call under assignment) keep their
        # exact construct-to-construct containment.
        for node in inside:
            row = by_node.get(node)
            if row is None:
                continue
            parent_id = row.get("parentFactId", "")
            parent_node = parents.get(node)
            selected_parent = None
            while parent_node is not None and parent_node not in selected_set:
                parent_node = parents.get(parent_node)
            if parent_node is not None:
                selected_parent = parent_node
            if selected_parent not in inside and parent_id == container:
                row["parentFactId"] = fact_id
            elif selected_parent is None and not container:
                row["parentFactId"] = fact_id

    def group_statement_list(statements, container_node=None):
        straight = []

        def flush():
            nonlocal straight
            add_straight_region(straight, container_node)
            straight = []

        for statement in statements:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                flush()
                # Definitions are already first-class constructs. Their bodies
                # get their own straight-line regions.
                group_statement_list(getattr(statement, "body", []) or [], statement)
                continue

            if isinstance(statement, structured_statements):
                flush()

                for field in ("body", "orelse", "finalbody"):
                    nested = getattr(statement, field, None)
                    if isinstance(nested, list) and nested:
                        group_statement_list(nested, statement)

                for handler in getattr(statement, "handlers", []) or []:
                    if getattr(handler, "body", None):
                        group_statement_list(handler.body, handler)

                for case in getattr(statement, "cases", []) or []:
                    if getattr(case, "body", None):
                        group_statement_list(case.body, case)
                continue

            straight.append(statement)

        flush()

    group_statement_list(tree.body, None)
    selected.extend(synthetic_regions)

    # Rebuild children after region insertion/re-parenting so CSV parent and
    # children columns describe one canonical containment hierarchy.
    by_fact_id = {row["factId"]: row for row in selected}
    for row in selected:
        row["childFactIds"] = []
    for row in selected:
        parent_id = row.get("parentFactId", "")
        parent = by_fact_id.get(parent_id)
        if parent is not None:
            parent["childFactIds"].append(row["factId"])

    for row in selected:
        row.pop("_node", None)
    return selected

code_facts = []
for mod, info in modules.items():
    code_facts.extend(build_code_facts(mod, info))

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
    regions = build_regions(
        node.body,
        text,
        sid(rec["path"], rec["qualified"], node.lineno),
        node.lineno
    )

    for ref in refs:
        ref_line = int(ref.get("line") or 0)
        if ref_line <= 0:
            continue
        containing = [
            region for region in regions
            if int(region.get("startLine") or 0) <= ref_line <= int(region.get("endLine") or 0)
        ]
        if not containing:
            continue
        containing.sort(key=lambda region: (
            int(region.get("endLine") or 0) - int(region.get("startLine") or 0),
            -int(region.get("startLine") or 0)
        ))
        containing[0]["references"].append(dict(ref))

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

module_regions = []
for mod, info in modules.items():
    regions = build_regions(
        info["tree"].body,
        info["text"],
        f"module:{info['path']}",
        1
    )
    if regions:
        module_regions.append({
            "moduleName": mod,
            "sourcePath": info["path"],
            "regions": regions
        })

print(json.dumps({
    "version": 8,
    "symbols": symbols,
    "externalSymbols": external_symbols,
    "codeFacts": code_facts,
    "moduleRegions": module_regions
}, ensure_ascii=False))
