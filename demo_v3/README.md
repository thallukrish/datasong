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
