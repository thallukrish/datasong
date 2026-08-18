# DataSong demo_v3

`demo_v3` is the experimental teacher-student learning version of DataSong.

The goal is to move semantic navigation intelligence out of increasingly complex rule-based exploration heuristics and into a trainable student model, while keeping DataSong responsible for deterministic evidence generation, topology, state, provenance and execution.

The initial development mode is deliberately interactive:

```text
DataSong evidence engine
        ↓
student semantic scorer running locally
        ↓
ChatGPT teacher via MCP
        ↓
score comparison + weakness diagnosis
        ↓
targeted real/synthetic training samples
        ↓
student update
        ↓
DataSong advances using student scores
```

See [TEACHER_STUDENT_ARCHITECTURE.md](./TEACHER_STUDENT_ARCHITECTURE.md) for the design.

`demo_v2` remains the reference implementation for the current LLM-driven Scout / Discovery / Pass 1 / Pass 2 exploration system. `demo_v3` should reuse its canonical evidence/topology machinery where useful, but the semantic policy is now a learned-model problem.

## Implementation status

### Slice 1 — semantic contracts

```text
server/evidencePacket.js
  canonical DataSong → student evidence packet
  inspectable cross-encoder serialization

server/scorePolicy.js
  shared 0..1 student score contract
  deterministic Scout / Pass 1 / Pass 2 interpretation
  arc and neighbour ranking driven only by student scores

server/trainingStore.js
  append-only per-episode JSONL history
  episode numbering and checkpoint discovery
```

### Slice 2 — MCP teacher/student plumbing

The first ChatGPT-facing MCP surface is now implemented on the `demo_v3-mcp` branch.

```text
mcp/server.js
  MCP 2026-07-28 HTTP endpoint
  datasong.* tools
  student.* tools
  training.* tools

server/runtime.js
  interactive episode state
  neutral mock student for plumbing validation
  teacher-sample persistence
  scaffold train/evaluate loop
  deterministic application of STUDENT scores
```

The mock student deliberately contains no semantic-navigation heuristics. Before training it emits neutral scores. Scaffold training memorizes an exact teacher target only so the complete ChatGPT → MCP → student → DataSong control loop can be tested before UniXcoder is introduced.

Run locally with Node 20+:

```bash
cd demo_v3
npm install
npm test
npm run mcp
```

The MCP endpoint is:

```text
http://127.0.0.1:3113/mcp
```

Initial MCP tools:

```text
datasong.start_episode
datasong.get_state
datasong.get_evidence
datasong.apply_scores
datasong.advance
datasong.get_run_log
datasong.reset_or_restore

student.score
student.train
student.evaluate
student.get_metrics
student.save_checkpoint
student.restore_checkpoint

training.add_teacher_sample
training.add_synthetic_batch
training.get_episode
training.get_loss_history
training.get_skill_metrics
training.list_checkpoints
```

`student.save_checkpoint`, `student.restore_checkpoint`, and semantic skill metrics remain explicit placeholders until the real local student runtime is wired.

Tests include the contract tests plus `test/mcp-runtime.test.js`, which exercises one full scaffold episode:

```text
start episode
→ get evidence
→ neutral student score
→ add teacher target
→ train scaffold student
→ rescore
→ apply STUDENT scores
→ advance DataSong
```

## Next seam

The next implementation step is to replace the fixture evidence source with an adapter over the reusable deterministic `demo_v2` topology/evidence machinery. Once `datasong.get_evidence` returns a real PopNow packet through MCP, the UniXcoder student can replace the mock scorer behind the unchanged `student.*` tool contract.
