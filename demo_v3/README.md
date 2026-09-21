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

`demo_v2` is now reference material only. Any deterministic machinery reused from it is copied into `demo_v3` and evolves independently there. The `demo_v3` runtime must never import source from `demo_v2`.

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

```text
mcp/server.js
  ChatGPT-facing MCP endpoint
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

### Slice 3 — self-contained repository evidence

The deterministic repository topology needed from `demo_v2` has been copied into:

```text
server/topology/
  topology.js
  resolvedSymbolTopology.js
  boundaryAwareTopology.js
  semanticFunctionTopology.js
  canonicalSemanticTopology*.js
  progressiveRepositoryTopology*.js
```

`server/repositoryEvidence.js` adapts that v3-owned topology into the canonical student evidence packet.

A real episode can now begin with:

```text
datasong.start_episode({ repoUrl })
        ↓
clone/update repository in demo_v3/data/repo-cache
        ↓
build deterministic topology
        ↓
emit canonical repository evidence packet
        ↓
student.score
        ↓
teacher supervision / training
        ↓
datasong.apply_scores(STUDENT scores)
        ↓
datasong.advance
        ↓
resolve next artifact through demo_v3 topology
        ↓
next evidence packet
```

The Scout decision now carries the student-ranked next `artifactId`, so repository navigation can advance without falling back to a hidden semantic heuristic.

`test/self-contained.test.js` guards the architectural rule that v3 runtime code must not import `demo_v2`.

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

## Next seam

Run the first real repository episode through MCP and inspect the canonical packets produced by the self-contained v3 topology. Once that path is stable, replace the mock scorer behind the unchanged `student.*` contract with the local UniXcoder student.
