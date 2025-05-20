# LaTeX Translator

一个基于AST-Gen的LaTeX解析器，用于解析LaTeX文件或项目并输出抽象语法树(AST)，同时支持基于AST的LaTeX文档翻译功能。

## 功能

- 解析单个LaTeX文件或整个项目
- 支持识别和处理自定义宏定义
- 输出结构化的JSON格式AST
- 基于AST的LaTeX文档翻译，保留公式和特殊结构
- 自动添加中文支持（默认添加`\usepackage[UTF8]{ctex}`）
- 优化的项目结构组织，保留原始文件便于对比和参考
- 提供命令行接口和API接口
- 使用配置文件管理设置，方便部署和团队使用

## 安装

### 从源码安装

```bash
# 克隆仓库
git clone <repository_url>
cd LaTeX-Translator

# 安装依赖
npm install

# 构建项目
npm run build

# 全局安装（可选）
npm link
```

## 配置

本项目使用 [node-config](https://github.com/node-config/node-config) 管理配置。配置文件存放在 `config/` 目录下。

### 配置文件设置

1. 复制示例配置文件作为起点:
```bash
cp config/default.example.json config/default.json
```

2. 根据需要编辑 `config/default.json` 文件:
```json
{
  "openai": {
    "apiKey": "YOUR_API_KEY_HERE",
    "baseUrl": "https://api.openai.com/v1",
    "model": "gpt-3.5-turbo",
    "temperature": 0.3,
    "timeout": 60000
  },
  "translation": {
    "defaultTargetLanguage": "简体中文",
    "defaultSourceLanguage": "英文",
    "maskOptions": {
      "environments": ["equation", "align", "figure", "table"],
      "commands": ["ref", "cite", "includegraphics", "url"],
      "maskInlineMath": true,
      "maskDisplayMath": true,
      "maskComments": false,
      "maskPrefix": "MASK_"
    }
  },
  "output": {
    "defaultOutputDir": "./output"
  }
}
```

### 环境特定配置

您可以为不同环境创建不同的配置文件，如:
- `config/development.json`
- `config/production.json`
- `config/test.json`

使用环境变量 `NODE_ENV` 指定当前环境:
```bash
NODE_ENV=production node dist/cli.js translate ...
```

## 命令行用法

### 解析命令

```bash
latex-translator parse <输入路径> [选项]
```

#### 参数

- `<输入路径>`: LaTeX文件或项目目录的路径

#### 选项

- `-o, --output <文件路径>`: 输出JSON文件的路径（默认: output.json）
- `-p, --pretty`: 美化JSON输出
- `-m, --macros <文件路径>`: 包含自定义宏定义的JSON文件的路径
- `-n, --no-default-macros`: 不加载默认宏定义
- `-h, --help`: 显示帮助信息

#### 示例

```bash
# 解析单个文件并输出格式化JSON
latex-translator parse ./document.tex -o ast.json -p

# 解析项目目录并使用自定义宏
latex-translator parse ./project_dir -m ./custom_macros.json
```

### 翻译命令

```bash
latex-translator translate <输入路径> [选项]
```

#### 参数

- `<输入路径>`: LaTeX文件或项目目录的路径

#### 选项

- `--api-key <密钥>`: OpenAI API密钥 (可选，使用配置文件中的值)
- `--base-url <URL>`: OpenAI API基础URL (可选，使用配置文件中的值)
- `--model <模型名称>`: OpenAI模型 (可选，使用配置文件中的值)
- `--target-lang <语言>`: 目标语言 (可选，使用配置文件中的值)
- `--source-lang <语言>`: 源语言 (可选)
- `-o, --output-dir <目录>`: 输出基础目录 (可选，使用配置文件中的值)
- `--temp, --temperature <数值>`: 模型温度参数 (0-1) (可选，使用配置文件中的值)
- `--mask-env <环境>`: 要掩码的环境，用逗号分隔 (可选，使用配置文件中的值)
- `--mask-cmd <命令>`: 要掩码的命令，用逗号分隔 (可选，使用配置文件中的值)
- `--no-mask-math`: 不掩码数学公式 (可选，使用配置文件中的值)
- `-h, --help`: 显示帮助信息

#### 示例

```bash
# 使用配置文件中的设置翻译LaTeX文件
latex-translator translate ./document.tex

# 指定自定义设置覆盖配置文件中的值
latex-translator translate ./document.tex \
  --api-key "your_api_key" \
  --base-url "https://your-proxy-server.com" \
  --model "gpt-4" \
  --target-lang "英文" \
  --source-lang "中文" \
  --output-dir "./translated" \
  --temperature 0.5 \
  --mask-env "equation,align,figure" \
  --mask-cmd "ref,cite"
```

## 作为库使用

### 基本解析功能

```typescript
import { Translator, ProjectAST } from 'latex-translator';

async function main() {
  try {
    // 创建翻译器实例
    const translator = new Translator();
    
    // 解析LaTeX文件或项目
    const ast: ProjectAST = await translator.parse('./path/to/latex');
    
    // 保存为JSON
    await translator.saveAsJson(ast, 'output.json', true);
  } catch (error) {
    console.error('处理失败:', error);
  }
}
```

### 翻译功能

```typescript
import { LaTeXTranslator } from 'latex-translator';

async function main() {
  try {
    // 创建LaTeX翻译器实例，使用配置文件中的设置
    const translator = new LaTeXTranslator();
    
    // 或者提供自定义设置覆盖配置文件中的值
    const translatorWithCustomOptions = new LaTeXTranslator({
      openaiConfig: {
        apiKey: 'your_api_key', // 将覆盖配置文件中的值
        baseUrl: 'https://api.openai.com/v1' // 将覆盖配置文件中的值
      },
      targetLanguage: '英文', // 将覆盖配置文件中的值
      outputDir: './custom-output' // 将覆盖配置文件中的值
    });
    
    // 翻译LaTeX文件
    const outputPath = await translator.translate('./path/to/latex.tex');
    console.log(`翻译完成，输出文件: ${outputPath}`);
  } catch (error) {
    console.error('翻译失败:', error);
  }
}
```

## 工作原理

翻译功能的工作流程：

1. **解析**: 将LaTeX解析为AST
2. **掩码**: 识别并掩码数学公式、环境和命令等结构
3. **翻译**: 使用大语言模型翻译掩码后的纯文本
4. **替换**: 将翻译后的文本中的掩码标记替换回原始LaTeX结构
5. **增强**: 自动添加中文支持（如LaTeX文档中未包含）

## 项目结构

翻译过程会在指定的输出目录中创建以下项目结构：

```
output/
  <项目名>/                  - 以输入文件或文件夹名称命名的项目目录
    original/                - 包含原始文件的目录
      <原始文件和目录结构>
    translated/              - 包含翻译后文件的目录（可直接编译）
      <与原始结构相同的文件和目录，但.tex文件已翻译>
    log/                     - 包含中间过程文件和日志的目录
      <项目名>_ast.json      - AST结构
      <项目名>_masked.txt    - 掩码后的文本
      <项目名>_masked_map.json - 掩码节点映射
      <项目名>_translated.txt - 翻译后但未替换的文本
      translation_log.txt    - 翻译过程日志
```

### 中文支持

翻译器会自动在翻译后的文档中添加中文支持。如果原始文档未包含中文支持相关的宏包，系统会添加：

```latex
\usepackage[UTF8]{ctex} % 添加中文支持
```

此宏包会在`\documentclass`后自动插入，确保翻译后的文档能够正确显示中文字符。

如果原始文档已包含中文支持（如`\usepackage{ctex}`、`\usepackage[UTF8]{ctex}`或使用`ctexart`等文档类），则不会重复添加。

## 依赖项

- [AST-Gen](../AST-Gen): LaTeX AST生成器库
- [openai](https://github.com/openai/openai-node): OpenAI官方Node.js客户端
- [config](https://github.com/node-config/node-config): 配置管理库
- [yargs](https://yargs.js.org/): 命令行参数解析 