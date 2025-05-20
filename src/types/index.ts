/**
 * src/types/index.ts
 * 
 * 导出项目所有核心类型定义
 */

export * from './core.types';

// 如果 ast-gen 类型之前是通过项目根的 index.ts 导出的，
// 并且我们希望保持这种方式从 types/index.ts 统一导出，可以在这里加上：
// export type { ProjectAST, ParserOptions, ProjectFileAst, Ast } from 'ast-gen';
// 但是 core.types.ts 中已经导出了这些，所以上面的重复了。
// 如果不希望在 core.types.ts 中显式导出 ast-gen 类型，则可以在这里导出。
// 目前 core.types.ts 已导出，所以这里保持简洁。 