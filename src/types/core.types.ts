import { Ast, ProjectAST, ParserOptions, ProjectFileAst } from 'ast-gen';

// 从 latex-translator.ts 提取
export interface TranslatorOptions {
  // OpenAI配置
  openaiConfig?: Partial<OpenAIConfig>;
  // 目标语言
  targetLanguage?: string;
  // 源语言（可选）
  sourceLanguage?: string;
  // 掩码选项
  maskingOptions?: MaskingOptions;
  // 是否保存中间文件
  saveIntermediateFiles?: boolean;
  // 输出目录
  outputDir?: string;
  // 是否绕过LLM翻译
  bypassLLMTranslation?: boolean;
}

// 从 masker.ts 和 latex-translator.ts (maskingOptions 内部) 提取和合并
export interface MaskingOptions {
  // 需要掩码的普通环境类型
  regularEnvironments?: string[];
  // 需要掩码的数学环境类型
  mathEnvironments?: string[];
  // 需要掩码的命令
  maskCommands?: string[];
  // 需要掩码的内联数学
  maskInlineMath?: boolean;
  // 需要掩码的行间数学
  maskDisplayMath?: boolean;
  // 是否掩码注释
  maskComments?: boolean;
  // 掩码前缀
  maskPrefix?: string;
}

// 从 masker.ts 和 replacer.ts 提取
export interface MaskedNode {
  id: string;
  originalContent: Ast.Ast; // 确保 Ast 类型被正确导入或定义
}

// 从 openai-client.ts 提取
export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  timeout?: number;
}

// 从 latex-translator.ts 提取 (用于内部文件处理结果)
export interface FileTranslationResult {
  originalFilePath: string;
  translatedFilePath: string;
  maskedFilePath?: string;
  translatedTextFilePath?: string;
}

// 从 latex-translator.ts (ConfigMaskOptions) - 这是一个内部辅助类型，可以考虑是否提升为核心类型
// 如果它只在 latex-translator.ts 内部用于合并配置，则可能不需要导出
// 但如果 MaskingOptions 的默认值也希望由此结构化，可以考虑
export interface ConfigMaskOptionsForDefaults {
  regularEnvironments: string[];
  mathEnvironments: string[];
  maskCommands: string[];
  maskInlineMath: boolean;
  maskDisplayMath: boolean;
  maskComments: boolean;
  maskPrefix: string;
}


// 确保 ast-gen 的类型也在这里导出，或者通过 src/types/index.ts 统一导出
export { ProjectAST, ParserOptions, ProjectFileAst, Ast }; 