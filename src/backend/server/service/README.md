# LLM Service Core (Refactored)

This module represents the core LLM communication layer, refactored from JavaScript to **TypeScript** using the **Adapter** and **Simple Factory** design patterns. 

It acts as a robust bridge between the local application (Electron window/IPC) and LLM APIs, handling complex chat state, context truncation, streaming, and tool-call aggregation.

## 🏗 Architecture Highlights

To solve the tight-coupling and monolithic nature of the original `llm_service.js`, the code is now divided into three specific layers:

1. **`ChatManager` (State & Memory Layer)**
   - Manages the entire lifecycle of a conversation.
   - Handles saving/loading history arrays and truncating `long_memory`.
   - Replaces array manipulation logic previously scattered inside the service.
2. **`Adapters` (Protocol Layer)**
   - Normalizes different backend API formats.
   - `OpenAIAdapter`: Specifically formats context, builds payload, and parses tool_calling payloads for OpenAI-compatible APIs.
   - `PromptAdapter`: A fallback/alternative for non-standard or older models.
3. **`LLMService` (Network & Event Layer)**
   - Focuses solely on HTTP pipelines (fetch) and SSE Streams.
   - Implements the critical **Auto-Continuation (Truncation retry)** mechanism up to 3 times without mixing with model-specific payload rules.

## 📁 Directory Structure

\`\`\`text
├── src/
│   ├── types.ts                 # Global TypeScript interfaces
│   ├── adapters/
│   │   ├── IAdapter.ts          # Interface for all LLM Adapters
│   │   ├── OpenAIAdapter.ts     # OpenAI specific data parsing
│   │   └── PromptAdapter.ts     # Plain text prompt parsing
│   ├── core/
│   │   └── ChatManager.ts       # Handles array ops, memory & local JSON saving
│   ├── factories/
│   │   └── AdapterFactory.ts    # Dynamically injects the correct adapter
│   ├── utils/
│   │   ├── format.ts            # Safe string formatter (replacing String.prototype pollution)
│   │   ├── Utils.ts             # Refactored Utils class (Singleton)
│   │   └── globals.ts           # Central store and configuration entry
│   ├── stream.ts                # (Pending/External) SSE text-stream parser
│   └── LLMService.ts            # The main facade and execution flow
├── build.js                     # Custom compilation script
├── tsconfig.json                # TypeScript compiler configuration
└── package.json
\`\`\`

## 🚀 Getting Started

### 1. Install Dependencies
Ensure you are using Node.js v18+ (since `fetch` is used natively).
\`\`\`bash
pnpm install
\`\`\`

### 2. Build the Project
Compile the TypeScript source code into CommonJS (`./dist` folder).
\`\`\`bash
pnpm run build
\`\`\`

### 3. Development
Watch mode for auto-compilation during development.
\`\`\`bash
pnpm run dev
\`\`\`

## ⚠️ Breaking Changes & Improvements
- **No Global Prototype Pollution**: Removed `String.prototype.format`. Uses `formatString(template, data)` internally.
- **Type Safety**: The entire payload config `ChatRequestData` is now typed. Misspelled properties will be caught at compile-time.
- **Decoupled Scaling**: Want to add support for Claude or Ollama specific params? Just create a `ClaudeAdapter.ts`, implement `ILLMAdapter`, and register it in `AdapterFactory.ts`. `LLMService.ts` won't need to change.