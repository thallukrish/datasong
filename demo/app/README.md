# DataSong Semantic Explorer — YC demo harness

This app is deliberately tuned to demonstrate DataSong's core idea with a real open-source enterprise application. It is not the production DataSong architecture.

## Demo story

1. The page is prefilled with a short business description and a Git repository URL (initially Moqui POP Commerce).
2. The user clicks **Explore**.
3. A model explores the repository using bounded tools rather than receiving the whole repo at once.
4. As evidence is found, the model records business workflows, business concepts, persistent data, relationships and important branch/config conditions.
5. The React client receives semantic state over server-sent events and turns it into a living business wiki rather than exposing the raw semantic graph.
6. Workflows are the primary entry points. A workflow page tells the business story in plain language and links to concepts such as Customer, Product, Sales Order and Inventory.
7. Clicking a linked concept opens its own page, while the right-hand panel shows related workflows, business things and persistent data.
8. Exact entity/table names, service names and repository evidence remain available underneath the human-readable story as provenance.

The semantic graph still exists internally. The key UI principle is that people browse it as a coherent knowledge base instead of looking at a large visual graph that becomes difficult to understand as enterprise complexity grows.

## Architecture

```text
React business wiki
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
DeepSeek V4 Flash tool-calling loop
(OpenAI-compatible Chat Completions API)
```

The tool surface is intentionally MCP-shaped: repository evidence tools are separated from semantic recording tools, and all tool inputs/outputs are structured. The current demo calls them as function tools directly from Node; the same handlers can later be exposed through an MCP server without changing the semantic explorer's conceptual boundary.

The Node server uses the OpenAI JavaScript SDK only as an OpenAI-compatible HTTP client. Model requests are sent to DeepSeek at `https://api.deepseek.com` using `deepseek-v4-flash` by default.

## Business wiki presentation

The application deliberately separates the machine representation from the human presentation.

Internally DataSong may maintain relationships such as:

```text
Customer --places--> Sales Order
Sales Order --contains--> Order Item
Order Item --refers to--> Product
Sales Order --checks--> Inventory
```

The user sees these relationships as linked prose and browsable pages.

The main layout is:

```text
                    DataSong.app

             business description
             GitHub repository
                  Explore

        progress + current discovery

Business flows   Business wiki page       Related
--------------   ------------------       -------
Order placement  readable narrative       workflows
Approval         linked business terms    concepts
Fulfillment      business rules            data
...              technical provenance
```

Visible language should describe the business. Terms such as semantic node, persistent-data node and graph edge are implementation details and should not be the normal browsing vocabulary.

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
export DEEPSEEK_API_KEY=...
npm run dev
```

PowerShell:

```powershell
npm install
$env:DEEPSEEK_API_KEY="your-deepseek-api-key"
npm run dev
```

Optional model override:

```bash
export DEEPSEEK_MODEL=deepseek-v4-flash
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
    index.js       DeepSeek orchestration + SSE
    repoTools.js   clone/list/search/read repository
    modelTools.js  structured tool definitions + dispatch
    store.js       incremental semantic state
```

## Demo constraints

This version intentionally does not include authentication, multi-tenancy, arbitrary enterprise connectors, production graph storage, Trino deployment, runtime simulation or enterprise permissions. The goal is one strong, believable Moqui semantic-discovery journey that can also be recorded as the YC product demo.
