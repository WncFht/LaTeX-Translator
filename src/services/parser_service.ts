/**
 * src/services/parser.service.ts
 * 
 * 原 translator.ts，负责LaTeX解析和AST处理功能
 */

// import * as fs from 'fs/promises'; // FileService 将处理这些
import * as path from 'path';
import {
  parseLatexProject,
  serializeProjectAstToJson,
  ProjectAST,
  ParserOptions,
  Ast
} from 'ast-gen';
import { FileService } from './file_service'; // 路径相对于当前 services 目录

export class ParserService { // 重命名此类
  private fileService: FileService;

  constructor() {
    this.fileService = FileService.getInstance();
  }

  async parse(inputPath: string, options?: Omit<ParserOptions, 'entryPath'>): Promise<ProjectAST> {
    try {
      const absolutePath = path.resolve(inputPath);
      const parserOptions: ParserOptions = {
        entryPath: absolutePath,
        ...options
      };
      const ast = await parseLatexProject(parserOptions);
      return ast;
    } catch (error) {
      console.error('解析 LaTeX 项目失败:', error); // 中文注释
      throw error;
    }
  }

  async saveAsJson(ast: ProjectAST, outputPath: string, pretty: boolean = false): Promise<void> {
    try {
      const jsonString = serializeProjectAstToJson(ast, pretty);
      await this.fileService.writeFile(outputPath, jsonString, 'utf8');
      console.log(`AST 已保存至: ${outputPath}`); // 中文注释
    } catch (error) {
      console.error('保存 AST 为 JSON 失败:', error); // 中文注释
      throw error;
    }
  }

  async parseAndSave(
    inputPath: string,
    outputPath: string,
    options: {
      pretty?: boolean;
      macrosFile?: string;
      loadDefaultMacros?: boolean;
    } = {}
  ): Promise<void> {
    const ast = await this.parse(inputPath, {
      macrosFile: options.macrosFile,
      loadDefaultMacros: options.loadDefaultMacros
    });
    await this.saveAsJson(ast, outputPath, options.pretty);
    // 此方法返回 void，无需显式 return;
  }
} 