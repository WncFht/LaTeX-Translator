/**
 * translator.ts
 * 
 * AST-Gen包装类，提供LaTeX解析和AST处理功能
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  parseLatexProject,
  serializeProjectAstToJson,
  ProjectAST,
  ParserOptions,
  Ast
} from 'ast-gen';

export class Translator {
  /**
   * 解析单个LaTeX文件或项目
   * @param inputPath 文件或文件夹路径
   * @param options 解析选项
   * @returns 解析后的AST对象
   */
  async parse(inputPath: string, options?: Omit<ParserOptions, 'entryPath'>): Promise<ProjectAST> {
    try {
      // 解析输入路径，确保是绝对路径
      const absolutePath = path.resolve(inputPath);
      
      // 创建解析选项
      const parserOptions: ParserOptions = {
        entryPath: absolutePath,
        ...options
      };
      
      // 调用AST-Gen的解析函数
      const ast = await parseLatexProject(parserOptions);
      return ast;
    } catch (error) {
      console.error('解析失败:', error);
      throw error;
    }
  }

  /**
   * 将AST保存为JSON文件
   * @param ast 项目AST
   * @param outputPath 输出文件路径
   * @param pretty 是否美化输出
   */
  async saveAsJson(ast: ProjectAST, outputPath: string, pretty: boolean = false): Promise<void> {
    try {
      // 序列化AST为JSON字符串
      const jsonString = serializeProjectAstToJson(ast, pretty);
      
      // 确保输出目录存在
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });
      
      // 写入文件
      await fs.writeFile(outputPath, jsonString, 'utf8');
      console.log(`AST已保存到: ${outputPath}`);
    } catch (error) {
      console.error('保存JSON失败:', error);
      throw error;
    }
  }

  /**
   * 解析LaTeX文件或项目并保存为JSON
   * @param inputPath 输入路径
   * @param outputPath 输出路径
   * @param options 选项
   */
  async parseAndSave(
    inputPath: string,
    outputPath: string,
    options: {
      pretty?: boolean;
      macrosFile?: string;
      loadDefaultMacros?: boolean;
    } = {}
  ): Promise<void> {
    // 解析
    const ast = await this.parse(inputPath, {
      macrosFile: options.macrosFile,
      loadDefaultMacros: options.loadDefaultMacros
    });
    
    // 保存
    await this.saveAsJson(ast, outputPath, options.pretty);
    
    return;
  }
} 