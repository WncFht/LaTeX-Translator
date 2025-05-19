/**
 * index.ts
 * 
 * 项目入口点，导出所有公共API
 */

// 导出基本功能
export { Translator } from './translator';

// 导出翻译器功能
export { LaTeXTranslator, TranslatorOptions } from './latex-translator';
export { Masker } from './masker';
export { Replacer } from './replacer';
export { OpenAIClient, OpenAIConfig } from './openai-client';

// 导出AST-Gen的类型
export { ProjectAST, ParserOptions, ProjectFileAst, AstTypes } from 'ast-gen'; 