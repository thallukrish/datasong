#!/usr/bin/env python3
import ast, json, sys
from pathlib import Path
from urllib.parse import quote

root = Path(sys.argv[1]).resolve()
requested = json.loads(sys.stdin.read() or "[]")

PRIMITIVE_ANNOTATIONS = {
    "str", "int", "float", "bool", "bytes", "bytearray", "complex", "None",
    "typing.Any", "Any"
}
MUTATING_METHODS = {
    "append", "extend", "insert", "remove", "pop", "clear", "sort", "reverse",
    "update", "setdefault", "add", "discard", "difference_update",
    "intersection_update", "symmetric_difference_update"
}

def sid(source_path, qualified, line):
    return f"symbol:{source_path}#{quote(qualified, safe='')}@{line}"

def safe_unparse(node):
    try:
        return ast.unparse(node)
    except Exception:
        return ""

def root_name(node):
    while isinstance(node, (ast.Attribute, ast.Subscript)):
        node = node.value
    return node.id if isinstance(node, ast.Name) else ""

def call_name(node):
    if not isinstance(node, ast.Call):
        return ""
    return safe_unparse(node.func)

def constant_key(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, (str, int, float, bool)):
        return repr(node.value)
    return ""

def target_names(node):
    if isinstance(node, ast.Name):
        return [node.id]
    if isinstance(node, (ast.Tuple, ast.List)):
        out = []
        for item in node.elts:
            out.extend(target_names(item))
        return out
    return []

def value_shape(node):
    if node is None:
        return ""
    if isinstance(node, ast.Constant):
        if node.value is None:
            return "literal:none"
        return f"literal:{type(node.value).__name__}"
    if isinstance(node, ast.Dict):
        return "mapping"
    if isinstance(node, ast.List):
        return "sequence:list"
    if isinstance(node, ast.Tuple):
        return "sequence:tuple"
    if isinstance(node, ast.Set):
        return "set"
    if isinstance(node, ast.Call):
        name = call_name(node)
        return f"call:{name}" if name else "call"
    if isinstance(node, ast.Name):
        return "alias"
    if isinstance(node, ast.Attribute):
        return "member"
    if isinstance(node, ast.Subscript):
        return "subscript"
    if isinstance(node, ast.BinOp):
        return f"binop:{type(node.op).__name__}"
    if isinstance(node, ast.UnaryOp):
        return f"unary:{type(node.op).__name__}"
    if isinstance(node, ast.Compare):
        return "compare"
    if isinstance(node, ast.BoolOp):
        return f"boolop:{type(node.op).__name__}"
    return type(node).__name__.lower()

def access_shape(node):
    if isinstance(node, ast.Subscript):
        key = constant_key(node.slice)
        return {"access": "key", "name": key or safe_unparse(node.slice)}
    if isinstance(node, ast.Attribute):
        return {"access": "member", "name": node.attr}
    return {"access": "", "name": ""}

def processing_shape(parent):
    if parent is None:
        return ""
    if isinstance(parent, ast.Call):
        name = call_name(parent)
        return f"call:{name}" if name else "call"
    if isinstance(parent, ast.Return):
        return "return"
    if isinstance(parent, (ast.Assign, ast.AnnAssign, ast.NamedExpr)):
        return "assign"
    if isinstance(parent, ast.BinOp):
        return f"binop:{type(parent.op).__name__}"
    if isinstance(parent, ast.UnaryOp):
        return f"unary:{type(parent.op).__name__}"
    if isinstance(parent, ast.Compare):
        return "compare"
    if isinstance(parent, ast.BoolOp):
        return f"boolop:{type(parent.op).__name__}"
    if isinstance(parent, ast.Subscript):
        return "subscript"
    if isinstance(parent, ast.Attribute):
        return f"member:{parent.attr}"
    return type(parent).__name__.lower()

def value_origin(node):
    if isinstance(node, ast.Dict):
        keys = [constant_key(k) for k in node.keys]
        return {"kind": "mapping", "name": "dict", "keys": [k for k in keys if k]}
    if isinstance(node, ast.List):
        return {"kind": "sequence", "name": "list"}
    if isinstance(node, ast.Set):
        return {"kind": "set", "name": "set"}
    if isinstance(node, ast.Tuple):
        return {"kind": "sequence", "name": "tuple"}
    if isinstance(node, ast.Call):
        name = call_name(node)
        leaf = name.split(".")[-1] if name else ""
        if leaf in {"dict", "list", "set", "tuple"}:
            kind = "container"
        elif leaf[:1].isupper():
            kind = "constructed"
        else:
            kind = "call-result"
        return {"kind": kind, "name": name}
    if isinstance(node, ast.Name):
        return {"kind": "alias", "name": node.id}
    if isinstance(node, ast.Attribute):
        return {"kind": "member", "name": safe_unparse(node)}
    if isinstance(node, ast.Subscript):
        return {"kind": "subscript", "name": safe_unparse(node)}
    return {"kind": "", "name": ""}

class ObservationVisitor(ast.NodeVisitor):
    def __init__(self, source_path, qualified, function_id, node, ignored_names=None):
        self.source_path = source_path
        self.qualified = qualified
        self.function_id = function_id
        self.function_node = node
        self.records = {}
        self.parents = []
        self.events = []
        self.call_transfers = {}
        self.ignored_names = set(ignored_names or []) | {"self", "cls"}

        args = [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
        if node.args.vararg:
            args.append(node.args.vararg)
        if node.args.kwarg:
            args.append(node.args.kwarg)
        for index, arg in enumerate(args):
            rec = self.rec(arg.arg)
            if not rec:
                continue
            rec["parameter"] = True
            rec["parameterIndex"] = index
            if arg.annotation is not None:
                rec["annotation"] = safe_unparse(arg.annotation)

    def rec(self, name):
        if not name or name in self.ignored_names:
            return None
        if name not in self.records:
            self.records[name] = {
                "variable": name,
                "functionId": self.function_id,
                "functionName": self.qualified,
                "sourcePath": self.source_path,
                "firstLine": 0,
                "lastLine": 0,
                "parameter": False,
                "parameterIndex": -1,
                "annotation": "",
                "origins": [],
                "members": set(),
                "methods": set(),
                "keys": set(),
                "operations": set(),
                "passedTo": set(),
                "returned": False
            }
        return self.records[name]

    def add_event(self, name, node, operation, detail=None):
        if not name or name in self.ignored_names:
            return
        line = int(getattr(node, "lineno", 0) or 0)
        end_line = int(getattr(node, "end_lineno", line) or line)
        self.events.append({
            "variable": name,
            "operation": operation,
            "detail": detail if detail is not None else "",
            "line": line,
            "endLine": end_line
        })

    def touch(self, name, node, operation=None, detail=None):
        rec = self.rec(name)
        if not rec:
            return None
        line = int(getattr(node, "lineno", 0) or 0)
        if line:
            rec["firstLine"] = line if not rec["firstLine"] else min(rec["firstLine"], line)
            rec["lastLine"] = max(rec["lastLine"], int(getattr(node, "end_lineno", line) or line))
        if operation:
            rec["operations"].add(operation)
            self.add_event(name, node, operation, detail)
        return rec

    def visit(self, node):
        self.parents.append(node)
        try:
            return super().visit(node)
        finally:
            self.parents.pop()

    def visit_FunctionDef(self, node):
        if node is self.function_node:
            self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        if node is self.function_node:
            self.generic_visit(node)

    def record_call_transfer(self, node, result_variables=None):
        if not isinstance(node, ast.Call):
            return
        line = int(getattr(node, "lineno", 0) or 0)
        if not line:
            return
        transfer = self.call_transfers.get(line)
        if transfer is None:
            transfer = {
                "callerFunctionId": self.function_id,
                "callerFunctionName": self.qualified,
                "sourcePath": self.source_path,
                "line": line,
                "endLine": int(getattr(node, "end_lineno", line) or line),
                "targetName": call_name(node),
                "positionalArgs": [],
                "keywordArgs": [],
                "resultVariables": []
            }
            for arg in node.args:
                transfer["positionalArgs"].append(root_name(arg))
            for kw in node.keywords:
                transfer["keywordArgs"].append({
                    "name": kw.arg or "",
                    "variable": root_name(kw.value)
                })
            self.call_transfers[line] = transfer
        for name in result_variables or []:
            if name and name not in transfer["resultVariables"]:
                transfer["resultVariables"].append(name)

    def visit_Assign(self, node):
        origin = value_origin(node.value)
        if isinstance(node.value, ast.Call):
            result_variables = []
            for target in node.targets:
                result_variables.extend(target_names(target))
            self.record_call_transfer(node.value, result_variables)
        for target in node.targets:
            for name in target_names(target):
                rec = self.touch(name, node, "write")
                if rec and (origin.get("kind") or origin.get("name")):
                    rec["origins"].append(origin)
                    for key in origin.get("keys", []):
                        rec["keys"].add(key)
                    if origin.get("kind") in {"mapping", "sequence", "set", "container", "constructed"}:
                        self.add_event(name, node, "create", origin.get("name", ""))
            base = root_name(target)
            if base and isinstance(target, (ast.Attribute, ast.Subscript)):
                detail = access_shape(target)
                detail["valueKind"] = value_shape(node.value)
                self.touch(base, target, "mutate", detail)
        self.generic_visit(node)

    def visit_AnnAssign(self, node):
        if isinstance(node.value, ast.Call):
            self.record_call_transfer(node.value, target_names(node.target))
        for name in target_names(node.target):
            rec = self.touch(name, node, "write")
            if rec and node.annotation is not None:
                rec["annotation"] = safe_unparse(node.annotation)
            if rec and node.value is not None:
                origin = value_origin(node.value)
                if origin.get("kind") or origin.get("name"):
                    rec["origins"].append(origin)
                    for key in origin.get("keys", []):
                        rec["keys"].add(key)
                    if origin.get("kind") in {"mapping", "sequence", "set", "container", "constructed"}:
                        self.add_event(name, node, "create", origin.get("name", ""))
        base = root_name(node.target)
        if base and isinstance(node.target, (ast.Attribute, ast.Subscript)):
            detail = access_shape(node.target)
            detail["valueKind"] = value_shape(node.value)
            self.touch(base, node.target, "mutate", detail)
        self.generic_visit(node)

    def visit_AugAssign(self, node):
        base = root_name(node.target)
        if base:
            detail = access_shape(node.target)
            detail["valueKind"] = f"augassign:{type(node.op).__name__}:{value_shape(node.value)}"
            self.touch(base, node, "mutate", detail)
        self.generic_visit(node)

    def visit_Attribute(self, node):
        base = root_name(node)
        if base:
            operation = "read" if isinstance(node.ctx, ast.Load) else "mutate"
            detail = access_shape(node)
            if operation == "read":
                parent = self.parents[-2] if len(self.parents) >= 2 else None
                detail["afterRead"] = processing_shape(parent)
            rec = self.touch(base, node, operation, detail)
            if rec:
                rec["members"].add(node.attr)
        self.generic_visit(node)

    def visit_Subscript(self, node):
        base = root_name(node)
        if base:
            operation = "read" if isinstance(node.ctx, ast.Load) else "mutate"
            detail = access_shape(node)
            if operation == "read":
                parent = self.parents[-2] if len(self.parents) >= 2 else None
                detail["afterRead"] = processing_shape(parent)
            rec = self.touch(base, node, operation, detail)
            if rec:
                rec["operations"].add("index")
                key = constant_key(node.slice)
                if key:
                    rec["keys"].add(key)
        self.generic_visit(node)

    def visit_Call(self, node):
        self.record_call_transfer(node)
        if isinstance(node.func, ast.Attribute):
            base = root_name(node.func.value)
            if base:
                rec = self.touch(base, node, "mutate" if node.func.attr in MUTATING_METHODS else "read")
                if rec:
                    rec["methods"].add(node.func.attr)
        target = call_name(node)
        for arg in node.args:
            base = root_name(arg)
            if base:
                rec = self.touch(base, arg, "pass")
                if rec and target:
                    rec["passedTo"].add(target)
        for kw in node.keywords:
            base = root_name(kw.value)
            if base:
                rec = self.touch(base, kw.value, "pass")
                if rec and target:
                    rec["passedTo"].add(target)
        self.generic_visit(node)

    def visit_Return(self, node):
        if node.value is not None:
            base = root_name(node.value)
            if base:
                rec = self.touch(base, node.value, "return")
                if rec:
                    rec["returned"] = True
        self.generic_visit(node)

    def result(self):
        out = []
        for rec in self.records.values():
            annotation = rec["annotation"]
            origin_kinds = {item.get("kind") for item in rec["origins"] if item.get("kind")}
            boundary_evidence = (
                rec["parameter"] or rec["returned"] or bool(rec["passedTo"]) or
                "return" in rec["operations"] or "pass" in rec["operations"] or
                "call-result" in origin_kinds
            )
            complex_evidence = (
                boundary_evidence or
                bool(rec["members"]) or bool(rec["methods"]) or bool(rec["keys"]) or
                "index" in rec["operations"] or
                bool(origin_kinds & {"mapping", "sequence", "set", "container", "constructed"}) or
                (annotation and annotation not in PRIMITIVE_ANNOTATIONS)
            )
            if not complex_evidence:
                continue
            kind = "object"
            if rec["keys"] or "mapping" in origin_kinds:
                kind = "mapping"
            elif "sequence" in origin_kinds:
                kind = "sequence"
            elif "set" in origin_kinds:
                kind = "set"
            elif any(member in {"shape", "dtype", "ndim", "size"} for member in rec["members"]):
                kind = "array-like"
            rec["kind"] = kind
            rec["events"] = [
                event for event in self.events
                if event.get("variable") == rec["variable"]
            ]
            for key in ("members", "methods", "keys", "operations", "passedTo"):
                rec[key] = sorted(rec[key])
            out.append(rec)
        return out

    def transfers(self):
        return list(self.call_transfers.values())

modules = {}
module_imports = {}
for item in requested:
    path = (root / item).resolve()
    if not path.is_file() or path.suffix != ".py":
        continue
    try:
        text = path.read_text(encoding="utf-8")
        tree = ast.parse(text, filename=item)
    except (UnicodeDecodeError, SyntaxError):
        continue
    modules[item] = tree
    imported = set()
    for top in tree.body:
        if isinstance(top, ast.Import):
            for alias in top.names:
                imported.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(top, ast.ImportFrom):
            for alias in top.names:
                if alias.name != "*":
                    imported.add(alias.asname or alias.name)
    module_imports[item] = imported

observations = []
transfers = []
for source_path, tree in modules.items():
    for top in tree.body:
        if isinstance(top, (ast.FunctionDef, ast.AsyncFunctionDef)):
            q = top.name
            function_id = sid(source_path, q, top.lineno)
            visitor = ObservationVisitor(source_path, q, function_id, top, module_imports.get(source_path))
            visitor.visit(top)
            observations.extend(visitor.result())
            transfers.extend(visitor.transfers())
        elif isinstance(top, ast.ClassDef):
            for child in top.body:
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    q = f"{top.name}.{child.name}"
                    function_id = sid(source_path, q, child.lineno)
                    visitor = ObservationVisitor(source_path, q, function_id, child, module_imports.get(source_path))
                    visitor.visit(child)
                    observations.extend(visitor.result())
                    transfers.extend(visitor.transfers())

print(json.dumps({
    "version": 2,
    "observations": observations,
    "transfers": transfers
}, ensure_ascii=False))
