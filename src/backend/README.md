# TransmAgent Core (TypeScript v2.0)

TransmAgent is a powerful Electron-based desktop AI Assistant. It integrates LLM services, tool calling (Function Calling), code execution analysis, MCP (Model Context Protocol) client, and a React-based Agent workflow.

This project has been completely refactored using **TypeScript**, adopting **Adapter**, **Factory**, and **Singleton** patterns to ensure type safety, high cohesion, and low coupling.

## 🏗 Architectural Refactoring Highlights

1. **State Decoupling (`ChatManager`)**: 
   Message history and state manipulation have been extracted into `ChatManager`. `LLMService` now acts purely as an HTTP and SSE streaming pipeline.
2. **Adapter Pattern (`AdapterFactory`)**:
   Seamlessly switch between native `OpenAI` format and `Prompt` format models.
3. **Electron UI Layer (`src/main/windows`)**:
   All Electron windows (MainWindow, CodeWindow, ToolWindow, etc.) inherit from an abstract `BaseWindow` class. `WindowManager` handles singleton routing and prevents IPC memory leaks.
4. **Local Database & Services (`src/data` & `src/server`)**:
   Isolated data persistence (`MemoryDB`) and local web/worker services for background execution.

## 📁 Project Structure

```text
├── src/
│   ├── main.ts                   # Electron App entry point
│   ├── types.ts                  # Global TypeScript interfaces
│   ├── adapters/                 # Protocol adapters
│   │   ├── IAdapter.ts
│   │   ├── OpenAIAdapter.ts      # OpenAI / Function Calling format
│   │   └── PromptAdapter.ts      # Plain text / Ollama fallback
│   ├── core/                     # Agent & Business logic layer
│   │   ├── ChatManager.ts        # Message lifecycle & storage
│   │   ├── LLMService.ts         # Core HTTP & Stream processor
│   │   ├── ReActAgent.ts         # Agent base class (State machine)
│   │   ├── ToolCall.ts           # Function Calling executor
│   │   ├── ChainCall.ts          # Sequential multi-step caller
│   │   ├── base_tools.ts         # Built-in native tools definition
│   │   ├── Install.ts            # Bootstrapper (copies default configs)
│   │   ├── Plugins.ts            # Plugin loader
│   │   └── prompts/              # Specific tool prompts & JS scripts
│   ├── data/
│   │   └── MemoryDB.ts           # Local Database / Memory persistence
│   ├── factories/
│   │   └── AdapterFactory.ts     # Dynamically injects the correct adapter
│   ├── main/                     # Main process controllers
│   │   ├── Shortcut.ts           # Global shortcut manager
│   │   └── windows/              # Electron UI layer (BaseWindow & subclasses)
│   ├── server/                   # Local HTTP/Worker services
│   │   ├── MainServer.ts
│   │   ├── MainWorker.ts
│   │   └── WebServer.ts
│   └── utils/                    # Shared utilities
│       ├── globals.ts            # Centralized stores and constants
│       ├── Utils.ts              # File ops, JSON extraction, hashing
│       ├── stream.ts             # SSE stream parser
│       └── format.ts             # Safe template string formatter
├── build.js                      # Custom build script
├── package.json                  # Dependencies & Scripts
└── tsconfig.json                 # TypeScript compiler options
```

## 🚀 Getting Started

### 1. Install Dependencies
Make sure you have Node.js 18+ installed (native `fetch` is used).
```bash
pnpm install
```

### 2. Build the Project
Compile the TypeScript code into the `./dist` directory. The custom build script will automatically clean up old artifacts.
```bash
pnpm run build
```

### 3. Run the Application
Launch the Electron application (reads from `dist/main.js`).
```bash
pnpm start
```

### 4. Development Mode
To auto-recompile when saving files, run the TypeScript watcher in one terminal:
```bash
pnpm run dev
```
Then restart the Electron app via `pnpm start` in another terminal to see changes.

## 🛠 Key Features

- **ReAct & Chain Agents**: Choose between autonomous ReAct mode or strict predefined Chain sequences.
- **Smart Truncation & Auto-Continuation**: `LLMService` automatically detects if an output was truncated (`finish_reason: length`) and resumes seamlessly up to 3 times.
- **Context Optimization**: Supports background tasks that automatically compress redundant memory context to save tokens.
- **Native Code Assistance**: Provides specialized IPC handlers for code completion, code refactoring, and AST language detection via `CodeWindow`.
- **SSH / File Transfer**: Securely transfer files to remote environments directly via the native UI.

## 🔌 Hook Integration

External hook examples and integration docs are available here:

- `examples/hooks/README.md`
- `docs/hook_development.md`
- `docs/hook_system_prompt.md`
- `src/core/prompts/hook_aware_agent.ts`

Current runtime notes:

- Hook runtime config should be changed in the installed user config copy under `~/.transmagent/configs/`, not by editing repository example configs.
- Hook definitions belong under `tool_call.external_hooks`.
- Scheduler-side external task injection is handled through `heartbeat_before` / `heartbeat_after` hook outputs.

## 📝 License
ISC
