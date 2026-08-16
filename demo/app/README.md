# DataSong Semantic Explorer — YC demo harness

This app is deliberately tuned to demonstrate DataSong's core idea with a real open-source enterprise application. It is not the production DataSong architecture.

## Demo story

1. The page is prefilled with a short business description and a Git repository URL (initially Moqui POP Commerce).
2. The user clicks **Explore business**.
3. A model explores the repository using bounded tools rather than receiving the whole repo at once.
4. As evidence is found, the model records business workflows, persistent data, relationships, services and important branch/config conditions.
5. The React client receives semantic-map snapshots over server-sent events and grows one persistent visual map during exploration.
6. When exploration completes, the user can ask a demo question such as **Why did sales fall last quarter?** and see the relevant semantic path highlighted.

The final analytical answer is intentionally not implemented yet. The demo shows that the semantic map can identify the business flows and persistent datasets required to construct an analysis/ML view. A later layer can federate those datasets (for example through Trino) and optionally run analysis.

## Architecture

```text
React client
   |
   | POST /api/explore
   | SSE /api/events
   v
Node demo orchestrator
   |
   +-- repo_prepare
   +-- repo_list
   +-- repo_search
   +-- repo_read_file
   |
   +-- semantic_record_workflow
   +-- semantic_record_node
   +-- semantic_record_relation
   +-- semantic_record_persistent_data
   +-- semantic_record_condition
   +-- semantic_complete
   |
   v
OpenAI Responses API tool loop
```

The tool surface is intentionally MCP-shaped: repository evidence tools are separated from semantic recording tools, and all tool inputs/outputs are structured. The current demo calls them as OpenAI function tools directly from Node; the same handlers can later be exposed through an MCP server without changing the semantic explorer's conceptual boundary.

## Important semantic distinction

The explorer must distinguish transient runtime values from durable analytical data.

Examples:

```text
customerPartyId                 runtime input/value
priceMap.price                  derived runtime value
orderHeader EntityValue         runtime representation of a persistent record
OrderHeader                     persistent entity/dataset
OrderPart                       persistent entity/dataset
OrderItem                       persistent entity/dataset
AssetReservation                persistent entity/dataset
```

Only evidence-backed persistent reads/writes should be recorded using `semantic_record_persistent_data`.

## Runtime simulation

Runtime simulation is not required for the initial demo. The explorer should first use:

1. static code/workflow analysis,
2. symbolic/config branch reasoning,
3. schema/persistence evidence.

Runtime execution becomes useful later when static reasoning cannot resolve dynamic dispatch, framework callbacks, plugins, triggers, external systems or important reachability ambiguity, or when observed runtime/data evidence is useful to strengthen confidence.

## Running locally

From `demo/app`:

```bash
npm install
export OPENAI_API_KEY=...
npm run dev
```

Optional:

```bash
export OPENAI_MODEL=gpt-5.6
```

Then open `http://localhost:5173`.

The Node API listens on port `3101` by default.

## Files

```text
demo/app/
  package.json
  vite.config.js
  client/
    index.html
    src/
      main.jsx
      App.jsx
      styles.css
  server/
    index.js       OpenAI orchestration + SSE
    repoTools.js   clone/list/search/read repository
    modelTools.js  structured tool definitions + dispatch
    store.js       incremental semantic-map state
```

## Demo constraints

This version intentionally does not include authentication, multi-tenancy, arbitrary enterprise connectors, production graph storage, Trino deployment, runtime simulation or enterprise permissions. The goal is one strong, believable Moqui semantic-discovery journey that can also be recorded as the YC product demo.
