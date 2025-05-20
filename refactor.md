# LaTeX-Translator 重构建议

## 1. 引言

本文档旨在为 `LaTeX-Translator` 项目提供一套重构建议。重构的主要目标是提高代码的可维护性、可测试性、可扩展性，并使后续的调试工作更加便捷。我们将通过引入更清晰的服务分层、集中的配置管理和文件操作、以及改进的模块职责来达成这些目标。

## 2. 当前架构回顾

目前项目主要包含以下几个核心模块：

*   `cli.ts`: 命令行接口，负责解析用户输入参数并调用核心翻译或解析逻辑。
*   `translator.ts`: 封装了 `ast-gen` 库，提供 LaTeX 解析为 AST (Abstract Syntax Tree) 及将 AST 保存为 JSON 的功能。
*   `latex-translator.ts`: 项目的核心协调器，整合了从解析、掩码、API 调用、内容替换到文件输出的整个翻译流程。它也处理了大量的目录创建、文件复制等文件系统操作。
*   `masker.ts`: 负责遍历 AST，根据预设规则（如特定命令、环境、数学公式）将 LaTeX 内容替换为占位符（掩码），并记录原始信息。
*   `openai-client.ts`: 封装了与 OpenAI API 的交互，包括文本分块处理、API 请求构建和执行。
*   `replacer.ts`: 负责将经过翻译API处理后的文本（包含掩码）与之前 `masker.ts` 生成的原始节点信息结合，还原成最终的 LaTeX 文档。
*   `index.ts`: 项目的入口文件，导出公共 API 和类型。
*   `config.d.ts`: 为 `config` Node.js 模块提供的类型声明文件。

当前的架构功能完善，但随着项目复杂度的增加，部分模块职责较为宽泛，文件系统操作散布在多个模块中，配置读取也较为分散，这给后续的维护和扩展带来挑战。

## 3. 建议的重构项目框架

建议采用更清晰的服务化分层结构。核心逻辑将由专门的服务类处理，CLI 层负责参数解析和调用服务，文件操作和配置读取将集中管理。

```
LaTeX-Translator/
├── config/                  # 配置文件目录 (保持不变)
│   └── default.json
├── node_modules/
├── output/                  # 输出目录 (保持不变)
├── src/
│   ├── cli.ts               # 命令行接口 (职责简化)
│   ├── index.ts             # 公共 API 出口 (更新导出)
│   │
│   ├── services/            # 新增: 服务层目录
│   │   ├── parser.service.ts      # 原 translator.ts 核心功能
│   │   ├── masking.service.ts     # 原 masker.ts 核心功能
│   │   ├── translation.service.ts # 原 openai-client.ts 核心功能
│   │   ├── replacement.service.ts # 原 replacer.ts 核心功能
│   │   ├── file.service.ts        # 新增: 统一文件操作服务
│   │   ├── config.service.ts      # 新增: 统一配置读取服务
│   │   └── latex-translator.service.ts # 原 latex-translator.ts 核心流程编排
│   │
│   ├── types/               # 类型定义目录
│   │   ├── index.ts             # 导出所有类型
│   │   ├── ast-gen.types.ts     # ast-gen 相关类型 (如果需要单独管理)
│   │   ├── core.types.ts        # 项目核心类型 (如 TranslatorOptions)
│   │   └── config.d.ts          # config 模块声明文件 (可移至此处)
│   │
│   └── utils/               # 通用工具函数
│       ├── index.ts
│       └── latex.utils.ts       # 例如 isTexFile, addChineseSupport 等
│
├── test/                    # 测试文件目录 (建议添加)
├── .gitignore
├── package.json
├── README.md
└── tsconfig.json
```

## 4. 各核心文件职责 (重构后)

### `src/cli.ts`
*   **职责**: 命令行参数解析、命令分发、基本的用户反馈。
*   **内容**: 使用 `yargs` 解析命令行参数。根据解析到的命令（如 `parse` 或 `translate`），调用相应的服务层方法。尽量保持轻量，不包含复杂的业务逻辑。

### `src/index.ts`
*   **职责**: 项目的公共 API 出口。
*   **内容**: 导出所有需要外部（例如，如果此项目作为库被其他项目使用）或内部模块间清晰引用的类、接口、类型。

### `src/services/config.service.ts` (新增)
*   **职责**: 集中管理配置的读取和访问。
*   **内容**: 提供一个单例服务或静态方法，用于安全地从 `config` 模块获取配置项，处理默认值，以及合并来自不同来源（如文件、环境变量、命令行参数）的配置。

### `src/services/file.service.ts` (新增)
*   **职责**: 封装所有文件系统操作。
*   **内容**: 提供异步方法用于读写文件 (`readFile`, `writeFile`)、创建目录 (`mkdirRecursive`)、复制文件和目录 (`copyFile`, `copyDirectoryRecursive`)、检查文件状态 (`stat`) 等。这将使其他服务不直接依赖 `fs/promises`，便于测试和维护。

### `src/services/parser.service.ts` (原 `translator.ts`)
*   **职责**: 负责 LaTeX 项目的解析和 AST 处理。
*   **内容**:
    *   封装 `ast-gen` 的 `parseLatexProject` 方法。
    *   提供 `serializeProjectAstToJson` 方法。
    *   包含 `parseAndSave` 逻辑，协调解析和保存JSON。
    *   可以包含如 `findRootFile` 等与解析强相关的辅助功能。

### `src/services/masking.service.ts` (原 `masker.ts`)
*   **职责**: 负责根据配置对 AST 进行掩码处理。
*   **内容**:
    *   接收 `ProjectFileAst` 或 `ProjectAST` 和掩码配置。
    *   核心的 AST 遍历逻辑 (`processNodes` 系列方法) 来识别和替换目标节点。
    *   生成掩码后的文本字符串和 `maskedNodesMap`。
    *   `saveMaskedText` 和 `saveMaskedNodesMap` 的文件写入操作将委托给 `FileService`，路径由调用方（`LatexTranslatorService`）提供。

### `src/services/translation.service.ts` (原 `openai-client.ts`)
*   **职责**: 封装与外部翻译服务（如 OpenAI API）的交互。
*   **内容**:
    *   初始化和配置 API 客户端。
    *   `translateText` 方法用于翻译单段文本。
    *   `translateLargeText` 方法处理文本分块、逐块翻译、重试逻辑。
    *   `createTranslationPrompt` 构建符合API要求的提示。
    *   日志记录（翻译过程中的成功/失败）可以写入指定路径（通过 `FileService`）。

### `src/services/replacement.service.ts` (原 `replacer.ts`)
*   **职责**: 负责将翻译后的文本中的掩码替换回原始的 LaTeX 内容。
*   **内容**:
    *   接收翻译后的文本字符串和 `maskedNodesMap`。
    *   `replaceTranslatedText` 方法，使用正则表达式或更精确的查找方式定位并替换掩码。
    *   `nodeToLatex` 系列方法，将 AST 节点转换回其 LaTeX 字符串表示。
    *   `fromSavedMap`（如果需要从文件加载映射）和 `saveReplacedText` 的文件操作将委托给 `FileService`。

### `src/services/latex-translator.service.ts` (原 `latex-translator.ts`)
*   **职责**: 核心的翻译流程编排服务。
*   **内容**:
    *   `translate(inputPath, options)` 作为主要入口点。
    *   协调调用其他服务：`ConfigService`, `FileService`, `ParserService`, `MaskingService`, `TranslationService`, `ReplacementService`。
    *   管理整个翻译项目的状态，如输入路径、输出目录、处理过的文件列表、根文件等。
    *   实现高层逻辑：
        *   `setupProjectDirectories`: 创建项目输出目录结构（original, translated, log）。
        *   `copyOriginalProject`: 将原始项目文件复制到 `original/` 目录。
        *   `processSingleFile` / `processMultiFileProject`: 编排单个或多个文件的掩码、翻译、替换流程。
        *   `copyNonTexFiles`: 将非 TeX 文件从 `original/` 复制到 `translated/`。
        *   调用 `latex.utils.ts` 中的 `addChineseSupport`。
    *   负责将中间产物（如 AST JSON, masked text, translated masked text, masked map）通过 `FileService` 保存到 `log/` 目录。

### `src/types/`
*   **职责**: 存放项目中所有的 TypeScript 类型定义和接口。
*   **内容**:
    *   `core.types.ts`: 定义如 `TranslatorOptions`, `MaskingOptions`, `OpenAIConfig`, `MaskedNode` 等核心业务类型。
    *   `ast-gen.types.ts`: 如果 `ast-gen` 的类型复杂且多处使用，可以单独存放。
    *   `index.ts`: 从此目录导出所有类型，方便其他模块导入。
    *   `config.d.ts`: 迁移至此。

### `src/utils/latex.utils.ts`
*   **职责**: 存放与 LaTeX 处理相关的、不适合放在特定服务类中的通用辅助函数。
*   **内容**: `isTexFile` (判断文件是否为 TeX 相关文件)，`addChineseSupport` (向 LaTeX 内容中添加中文支持包)，`getRelativePath` (根据项目根路径计算文件的相对路径，原 `latex-translator.ts` 中的 `getRelativeFilePath` 方法的重构版本) 等。

## 5. 整体处理逻辑流程 (重构后)

**通用启动**:
1.  用户通过命令行执行程序。
2.  `src/cli.ts` 使用 `yargs` 解析参数。
3.  `src/cli.ts` 根据命令（`parse` 或 `translate`）实例化并调用相应的服务。

**`parse` 命令流程**:
1.  `cli.ts` 调用 `ParserService.parseAndSave(inputPath, outputPath, options)`.
2.  `ParserService`:
    a.  调用内部 `parse(inputPath, options)` 方法（原 `Translator.parse`），使用 `ast-gen` 解析 LaTeX 项目，得到 `ProjectAST`。
    b.  调用内部 `saveAsJson(ast, outputPath, pretty)` 方法（原 `Translator.saveAsJson`），将 AST 序列化并通过 `FileService.writeFile` 保存。

**`translate` 命令流程**:
1.  `cli.ts` 构造 `TranslatorOptions` 并调用 `LatexTranslatorService.translate(inputPath, options)`.
2.  `LatexTranslatorService.translate()`:
    a.  使用 `ConfigService` 获取和合并最终的翻译配置。
    b.  调用 `FileService` 执行 `setupProjectDirectories` 创建输出目录结构 (`output/<projectName>/{original, translated, log}`).
    c.  调用 `ParserService.parse(inputPath)` 获取 `ProjectAST` (`this.originalAst`).
    d.  调用 `FileService` 执行 `copyOriginalProject`，将原始文件/项目复制到 `originalDir`。 同时确定 `this.rootFile`。
    e.  (可选) 调用 `ParserService.saveAsJson(this.originalAst, logFilePath)` 将原始 AST 保存到 `logDir`。
    f.  **文件处理**:
        *   **单文件项目**: 调用 `this.processSingleFile(inputPath, this.originalAst)`。
        *   **多文件项目**: 调用 `this.processMultiFileProject(this.originalAst)`，该方法会遍历 `ast.files`：
            i.  对于每个文件 (`fileAst`):
                1.  `FileService.readFile` 读取原始文件内容 (从 `originalDir` 下的相对路径)。
                2.  `MaskingService.maskAst(singleFileAst)` (其中 `singleFileAst` 是为当前文件构造的 AST 对象) 得到 `{ maskedText, maskedNodesMap }`。
                3.  (可选) `FileService.writeFile` 将 `maskedText` 保存到 `logDir/<fileIdentifier>_masked.txt`。
                4.  (可选) `FileService.writeFile` 将 `maskedNodesMap` (序列化为JSON) 保存到 `logDir/<fileIdentifier>_masked_map.json`。
                5.  `TranslationService.translateLargeText(maskedText, targetLang, ...)` 得到 `translatedMaskedText`。日志将由 `TranslationService` 内部通过 `FileService` 写入 `logDir/translation_log.txt`。
                6.  (可选) `FileService.writeFile` 将 `translatedMaskedText` 保存到 `logDir/<fileIdentifier>_translated.txt`。
                7.  `ReplacementService.replaceTranslatedText(translatedMaskedText, maskedNodesMap)` 得到 `finalTranslatedText`。
                8.  调用 `LatexUtils.addChineseSupport(finalTranslatedText)` 添加中文支持。
                9.  `FileService.writeFile` 将最终文本保存到 `translatedDir` 下的相应相对路径。
                10. 记录已处理文件。
    g.  调用 `FileService` 执行 `copyNonTexFiles`，将 `originalDir` 中的非 TeX 文件复制到 `translatedDir`。
    h.  返回翻译后的主 TeX 文件路径或 `translatedDir` 路径。

## 6. 详细重构步骤

**✅ 阶段 0: 准备工作**
*   [X] **备份项目**: 在开始重构前，确保对当前项目代码进行版本控制备份。
*   [X] **建立新目录结构**: 在 `src/`下创建 `services/`, `types/`, `utils/` 目录。

**✅ 阶段 1: 类型和配置、文件服务分离**
*   [X] **迁移类型**:
    *   创建 `src/types/core.types.ts`。将 `TranslatorOptions`, `MaskingOptions` (来自 `latex-translator.ts` 和 `masker.ts`), `OpenAIConfig` (来自 `openai-client.ts`), `MaskedNode` (来自 `masker.ts` 和 `replacer.ts`) 等核心接口和类型定义移入此文件。
    *   创建 `src/types/index.ts` 并从中导出所有类型。
    *   将 `src/types/config.d.ts` 移至 `src/types/config.d.ts` (如果目录结构调整了)。
    *   更新所有文件，使其从 `src/types` 导入类型。
*   [X] **创建 `ConfigService`**: (`src/services/config.service.ts`)
    *   实现 `getConfigOrDefault` 逻辑，使其成为一个可复用的服务或工具类。
    *   更新 `cli.ts`, `latex-translator.ts` (稍后变为 `LatexTranslatorService`), `openai-client.ts` (稍后变为 `TranslationService`), `masker.ts` (稍后变为 `MaskingService`) 以使用 `ConfigService` 获取配置。
*   [X] **创建 `FileService`**: (`src/services/file.service.ts`)
    *   封装 `fs/promises` 的常用操作：`readFile`, `writeFile`, `mkdir` (确保 `recursive: true`), `copyFile`, `stat`。
    *   实现 `copyDirectoryRecursive` 方法。
    *   开始替换 `latex-translator.ts`, `translator.ts`, `masker.ts`, `replacer.ts`, `openai-client.ts` (日志部分) 中的直接 `fs` 调用为 `FileService` 调用。这是一个渐进的过程，可以在后续步骤中逐步完成。

**✅ 阶段 2: 核心原子服务重构**
*   [X] **重构 `translator.ts` 为 `ParserService`**: (`src/services/parser.service.ts`)
    *   将 `Translator` 类重命名为 `ParserService`。
    *   其方法 `parse`, `saveAsJson`, `parseAndSave` 保持，但内部文件操作通过注入的 `FileService` 完成。
*   [X] **重构 `openai-client.ts` 为 `TranslationService`**: (`src/services/translation.service.ts`)
    *   将 `OpenAIClient` 类重命名为 `TranslationService`。
    *   其方法 `translateText`, `translateLargeText`, `createTranslationPrompt`, `splitTextIntoChunks` 保持。
    *   依赖 `ConfigService` (获取API密钥、模型等) 和 `FileService` (写入翻译日志)。
*   [X] **重构 `masker.ts` 为 `MaskingService`**: (`src/services/masking.service.ts`)
    *   将 `Masker` 类重命名为 `MaskingService`。
    *   核心方法 `maskAst`, `maskFileAst`, `processNodes` 系列保持。
    *   构造函数接收掩码选项（从 `ConfigService` 获取）。
    *   移除 `saveMaskedText` 和 `saveMaskedNodesMap` 方法（这些将由编排服务使用 `FileService` 处理）。
*   [X] **重构 `replacer.ts` 为 `ReplacementService`**: (`src/services/replacement.service.ts`)
    *   将 `Replacer` 类重命名为 `ReplacementService`。
    *   核心方法 `replaceTranslatedText`, `nodeToLatex` 系列保持。
    *   移除 `fromSavedMap` (如果涉及文件读取，逻辑移至编排层) 和 `saveReplacedText` 方法。
    *   构造函数接收 `maskedNodesMap`。

**✅ 阶段 3: 编排服务和工具类重构**
*   [X] **创建 `LatexUtils`**: (`src/utils/latex.utils.ts`)
    *   将 `isTexFile` (原 `latex-translator.ts` 中的实现) 和 `addChineseSupport` (原 `latex-translator.ts` 中的方法) 移入此文件。
    *   将 `latex-translator.ts` 中的 `getRelativeFilePath` 方法重构为一个纯函数 `getRelativePath(absoluteFilePath: string, projectRootPath: string): string` 并移入此文件。
*   [X] **重构 `latex-translator.ts` 为 `LatexTranslatorService`**: (`src/services/latex-translator.service.ts`)
    *   将 `LaTeXTranslator` 类重命名为 `LatexTranslatorService`。
    *   构造函数注入所有依赖的服务: `ConfigService`, `FileService`, `ParserService`, `MaskingService`, `TranslationService`, `ReplacementService`, 和 `LatexUtils`。
    *   主要方法 `translate(inputPath)` 将编排整个流程。
    *   内部方法如 `setupProjectDirectories`, `copyOriginalProject`, `processSingleFile`, `processMultiFileProject`, `copyNonTexFiles` 将调用注入的服务完成各自任务。
    *   所有文件系统操作（包括保存中间文件到 `logDir`）都通过 `FileService`。
    *   管理项目级状态（如 `originalAst`, `projectDir`, `originalDir`, `translatedDir`, `logDir`, `rootFile`, `processedFiles`）。

**✅ 阶段 4: 更新 CLI 和入口点**
*   [X] **更新 `cli.ts`**:
    *   在 `main` 函数或相应的命令处理函数中，实例化新的服务 (`ConfigService`, `FileService` (如果CLI直接用), `ParserService`, `LatexTranslatorService`)。
    *   `handleParseCommand` 调用 `ParserService.parseAndSave`。
    *   `handleTranslateCommand` 构造 `TranslatorOptions` (可能通过 `ConfigService` 获取部分默认值) 并调用 `LatexTranslatorService.translate`。
*   [X] **更新 `index.ts`**:
    *   修改导出语句，以反映新的服务类名和文件结构。导出所有公开的服务、核心类型和工具函数。

**✅ 阶段 5: 测试和验证**
*   [X] **进行全面手动测试**:
    *   测试单文件解析和翻译。
    *   测试多文件项目解析和翻译。
    *   测试不同的命令行选项 (`--pretty`, `--macros`, `--output-dir`, API 相关参数, 掩码选项等)。
    *   验证输出目录结构和文件内容是否正确。
    *   检查 `log/` 目录中的中间文件。
    *   **特别注意**: 验证 `ReplacementService` 是否成功将所有 `MASK_...` 占位符替换回原始 LaTeX 内容。如果最终输出的 `.tex` 文件仍包含掩码，需在 `ReplacementService.replaceTranslatedText` 方法中添加详细日志，打印匹配到的掩码、从`maskedNodesMap`获取的节点信息、以及`nodeToLatex`的返回值，以诊断问题。
*   [ ] **编写单元测试 (推荐)**:
    *   为 `ConfigService`, `FileService` (可以使用 `memfs` 或 `mock-fs` 模拟文件系统) 编写单元测试。
    *   为 `ParserService`, `MaskingService`, `TranslationService` (可 mock API调用), `ReplacementService` 中的纯逻辑部分编写单元测试。
    *   为 `LatexUtils` 编写单元测试。

**✅ 阶段 6: 代码清理和文档更新**
*   [X] **移除旧文件**: 删除重构前的 `.ts` 文件（如旧的 `translator.ts`, `latex-translator.ts` 等）。
*   [ ] **更新 JSDoc/TSDoc**: 为所有新的和修改过的类、方法、接口添加或更新文档注释。
*   [ ] **更新 `README.md`**: 如果项目的模块结构、CLI用法或对外暴露的API有显著变化，需要更新 `README.md`。

## 7. 潜在的进一步改进

*   **依赖注入 (DI)**: 引入一个DI容器（如 `tsyringe`, `InversifyJS`）来管理服务实例及其依赖关系，这将使代码更松耦合，测试更方便。
*   **更高级的日志系统**: 使用如 `winston` 或 `pino` 这样的专业日志库，以支持不同的日志级别、格式和输出目标。
*   **错误处理**: 设计一套更统一和健壮的错误处理机制，例如使用自定义错误类，并在服务边界清晰地捕获和转换错误。
*   **AST 遍历器模式**: `MaskingService` 和 `ReplacementService` 中都有 AST 遍历逻辑。可以考虑抽象出一个通用的 `ASTVisitor` 或使用 `ast-gen` 可能提供的遍历工具。
*   **配置加载与合并**: `ConfigService` 可以做得更强大，例如支持按环境加载不同配置文件，或者更细致地合并来自文件、环境变量和命令行参数的配置。
*   **异步流程优化**: 对于多文件项目的处理，可以探索使用 `Promise.all` 或类似机制并行处理文件（需注意外部API的速率限制）。
*   **状态管理**: `LatexTranslatorService` 中的许多实例变量可以封装到一个上下文对象 (Context Object) 中，在方法间传递，以减少类的状态。
*   **插件化架构**: 考虑为某些可变部分（如特定掩码规则、翻译后处理步骤）设计插件接口，以提高系统的可扩展性。

通过以上步骤，`LaTeX-Translator` 项目的结构将更加清晰，职责更加明确，为未来的发展打下坚实的基础。
