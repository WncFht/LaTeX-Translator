/**
 * latex-translator.ts
 * 
 * LaTeX翻译器主类，整合掩码、翻译和替换功能
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import config from 'config';
import { parseLatexProject, ProjectAST, AstTypes, serializeProjectAstToJson, findRootFile, isTexFile } from 'ast-gen';
import { Masker } from './masker';
import { OpenAIClient, OpenAIConfig } from './openai-client';
import { Replacer } from './replacer';
import { Translator } from './translator';

export interface TranslatorOptions {
  // OpenAI配置
  openaiConfig?: Partial<OpenAIConfig>;
  // 目标语言
  targetLanguage?: string;
  // 源语言（可选）
  sourceLanguage?: string;
  // 掩码选项
  maskingOptions?: {
    regularEnvironments?: string[];
    mathEnvironments?: string[];
    maskCommands?: string[];
    maskInlineMath?: boolean;
    maskDisplayMath?: boolean;
    maskComments?: boolean;
    maskPrefix?: string;
  };
  // 是否保存中间文件
  saveIntermediateFiles?: boolean;
  // 输出目录
  outputDir?: string;
}

interface ConfigMaskOptions {
  regularEnvironments: string[];
  mathEnvironments: string[];
  commands: string[];
  maskInlineMath: boolean;
  maskDisplayMath: boolean;
  maskComments: boolean;
  maskPrefix: string;
}

export class LaTeXTranslator {
  private options: Required<Pick<TranslatorOptions, 'targetLanguage' | 'saveIntermediateFiles' | 'outputDir'>>;
  private translator: Translator;
  private masker: Masker;
  private openaiClient: OpenAIClient;
  private originalAst: ProjectAST | null;
  private projectDir: string;
  private originalDir: string;
  private translatedDir: string;
  private logDir: string;
  private rootFile: string | null;
  
  constructor(options: TranslatorOptions = {}) {
    // 从配置文件获取默认值，使用try-catch处理可能的错误
    const getConfigOrDefault = <T>(path: string, defaultValue: T): T => {
      try {
        return config.get<T>(path);
      } catch (error) {
        return defaultValue;
      }
    };
    
    // 获取掩码选项，如果配置文件中没有，使用默认值
    const defaultMaskOptions: ConfigMaskOptions = {
      regularEnvironments: ['figure', 'table', 'algorithm', 'enumerate', 'itemize', 'tabular', 'lstlisting'],
      mathEnvironments: ['equation', 'align', 'gather', 'multline', 'eqnarray', 'matrix', 'pmatrix', 'bmatrix', 'array', 'aligned', 'cases', 'split'],
      commands: ['ref', 'cite', 'eqref', 'includegraphics', 'url', 'label', 'textit', 'textbf', 'texttt', 'emph', 'href', 'caption', 'footnote', 'item'],
      maskInlineMath: true,
      maskDisplayMath: true,
      maskComments: false,
      maskPrefix: 'MASK_'
    };
    
    // 尝试从配置文件获取掩码选项
    let configMaskOptions: ConfigMaskOptions;
    try {
      configMaskOptions = config.get<ConfigMaskOptions>('translation.maskOptions');
    } catch (error) {
      configMaskOptions = defaultMaskOptions;
    }
    
    // 合并配置文件和用户提供的选项
    this.options = {
      targetLanguage: options.targetLanguage || 
        getConfigOrDefault('translation.defaultTargetLanguage', '简体中文'),
      saveIntermediateFiles: options.saveIntermediateFiles !== undefined 
        ? options.saveIntermediateFiles 
        : true,
      outputDir: options.outputDir || 
        getConfigOrDefault('output.defaultOutputDir', './output')
    };
    
    // 初始化组件
    this.translator = new Translator();
    
    // 初始化掩码器
    this.masker = new Masker({
      regularEnvironments: options.maskingOptions?.regularEnvironments || configMaskOptions.regularEnvironments,
      mathEnvironments: options.maskingOptions?.mathEnvironments || configMaskOptions.mathEnvironments,
      maskCommands: options.maskingOptions?.maskCommands || configMaskOptions.commands,
      maskInlineMath: options.maskingOptions?.maskInlineMath !== undefined 
        ? options.maskingOptions.maskInlineMath 
        : configMaskOptions.maskInlineMath,
      maskDisplayMath: options.maskingOptions?.maskDisplayMath !== undefined 
        ? options.maskingOptions.maskDisplayMath 
        : configMaskOptions.maskDisplayMath,
      maskComments: options.maskingOptions?.maskComments !== undefined 
        ? options.maskingOptions.maskComments 
        : configMaskOptions.maskComments,
      maskPrefix: options.maskingOptions?.maskPrefix || configMaskOptions.maskPrefix
    });
    
    // 初始化OpenAI客户端（使用传入的配置或默认从配置文件加载）
    this.openaiClient = new OpenAIClient(options.openaiConfig);
    
    this.originalAst = null;
    this.projectDir = '';
    this.originalDir = '';
    this.translatedDir = '';
    this.logDir = '';
    this.rootFile = null;
  }
  
  /**
   * 翻译LaTeX文件或项目
   * @param inputPath 输入文件或目录路径
   */
  async translate(inputPath: string): Promise<string> {
    try {
      // 0. 创建项目目录结构
      await this.setupProjectDirectories(inputPath);
      
      // 1. 解析LaTeX为AST
      console.log('正在解析LaTeX文件...');
      this.originalAst = await this.parseLatex(inputPath);
      
      // 复制原始项目到原始目录
      await this.copyOriginalProject(inputPath);
      
      // 1.1 保存AST为JSON文件
      const astJsonPath = await this.saveAstAsJson(this.originalAst, inputPath);
      
      // 2. 掩码AST
      console.log('正在掩码AST...');
      const { maskedText, maskedNodesMap } = await this.masker.maskAst(this.originalAst);
      
      // 3. 保存掩码后的文本
      const maskedFilePath = await this.saveMaskedText(maskedText, inputPath);
      
      // 4. 保存掩码节点映射
      const maskedNodesMapPath = await this.saveMaskedNodesMap(maskedNodesMap, inputPath);
      
      // 5. 翻译掩码后的文本
      console.log('正在翻译文本...');
      const translatedText = await this.translateMaskedText(maskedText);
      
      // 6. 保存翻译后的文本
      const translatedFilePath = await this.saveTranslatedText(translatedText, inputPath);
      
      // 7. 替换掩码节点
      console.log('正在替换掩码节点...');
      const replacer = new Replacer(maskedNodesMap);
      const replacedText = replacer.replaceTranslatedText(translatedText);
      
      // 8. 为翻译后的文本添加中文支持
      const enhancedText = this.addChineseSupport(replacedText);
      
      // 9. 保存替换后的文本
      const outputFilePath = await this.saveReplacedText(enhancedText, inputPath);
      
      console.log('翻译完成！');
      console.log(`输出文件: ${outputFilePath}`);
      
      return outputFilePath;
    } catch (error) {
      console.error('翻译过程中出错:', error);
      throw error;
    }
  }
  
  /**
   * 设置项目目录结构
   * @param inputPath 输入文件或目录路径
   */
  private async setupProjectDirectories(inputPath: string): Promise<void> {
    // 获取原始文件/文件夹名称作为项目名
    const inputName = path.basename(inputPath, path.extname(inputPath));
    
    // 创建项目目录
    this.projectDir = path.join(this.options.outputDir, inputName);
    
    // 创建原始文件目录、翻译后文件目录和日志目录
    this.originalDir = path.join(this.projectDir, 'original');
    this.translatedDir = path.join(this.projectDir, 'translated');
    this.logDir = path.join(this.projectDir, 'log');
    
    // 创建所有目录
    await fs.mkdir(this.projectDir, { recursive: true });
    await fs.mkdir(this.originalDir, { recursive: true });
    await fs.mkdir(this.translatedDir, { recursive: true });
    await fs.mkdir(this.logDir, { recursive: true });
    
    console.log(`项目目录已创建: ${this.projectDir}`);
  }
  
  /**
   * 复制原始项目到原始目录
   * @param inputPath 输入文件或目录路径
   */
  private async copyOriginalProject(inputPath: string): Promise<void> {
    const inputStat = await fs.stat(inputPath);
    
    if (inputStat.isFile()) {
      // 如果是单个文件
      const fileName = path.basename(inputPath);
      const destPath = path.join(this.originalDir, fileName);
      await fs.copyFile(inputPath, destPath);
      this.rootFile = fileName;
      console.log(`已复制原始文件: ${destPath}`);
    } else if (inputStat.isDirectory()) {
      // 如果是目录，递归复制
      await this.copyDirectory(inputPath, this.originalDir);
      
      // 使用AST-Gen的findRootFile功能查找根文件
      const absoluteRootFile = await findRootFile(this.originalDir);
      
      if (absoluteRootFile) {
        // 获取相对于原始目录的路径
        this.rootFile = path.relative(this.originalDir, absoluteRootFile);
        console.log(`已复制原始项目到: ${this.originalDir}`);
        console.log(`根文件: ${this.rootFile}`);
      } else {
        console.warn('未找到根文件，请手动指定根文件');
      }
    }
  }
  
  /**
   * 递归复制目录
   * @param src 源目录
   * @param dest 目标目录
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
  
  /**
   * 添加中文支持到LaTeX文档
   * @param texContent LaTeX文档内容
   */
  private addChineseSupport(texContent: string): string {
    // 检查是否已经有中文支持
    if (texContent.includes('\\usepackage{ctex}') || 
        texContent.includes('\\usepackage[UTF8]{ctex}') ||
        texContent.includes('\\documentclass[UTF8]{ctexart}')) {
      return texContent;
    }
    
    // 在documentclass后添加ctex包
    return texContent.replace(
      /(\\documentclass(?:\[.*?\])?\{.*?\})/,
      '$1\n\\usepackage[UTF8]{ctex} % 添加中文支持'
    );
  }
  
  /**
   * 解析LaTeX为AST
   * @param inputPath 输入文件或目录路径
   * @returns LaTeX项目的AST
   */
  private async parseLatex(inputPath: string): Promise<ProjectAST> {
    try {
      return await this.translator.parse(inputPath);
    } catch (error) {
      console.error('解析LaTeX失败:', error);
      throw error;
    }
  }
  
  /**
   * 保存AST为JSON文件
   * @param ast 项目AST
   * @param originalPath 原始文件路径
   * @returns 保存的JSON文件路径
   */
  private async saveAstAsJson(ast: ProjectAST, originalPath: string): Promise<string> {
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const astJsonPath = path.join(this.logDir, `${originalFileName}_ast.json`);
    
    // 序列化AST为JSON
    const jsonContent = serializeProjectAstToJson(ast, true); // true表示格式化JSON
    
    // 保存到文件
    await fs.writeFile(astJsonPath, jsonContent, 'utf8');
    
    console.log(`AST已保存到: ${astJsonPath}`);
    return astJsonPath;
  }
  
  /**
   * 保存掩码后的文本
   * @param maskedText 掩码后的文本
   * @param originalPath 原始文件路径
   * @returns 保存的文件路径
   */
  private async saveMaskedText(maskedText: string, originalPath: string): Promise<string> {
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const maskedFilePath = path.join(this.logDir, `${originalFileName}_masked.txt`);
    
    // 保存掩码后的文本
    await fs.writeFile(maskedFilePath, maskedText, 'utf8');
    console.log(`掩码后的文本已保存到: ${maskedFilePath}`);
    
    return maskedFilePath;
  }
  
  /**
   * 保存掩码节点映射
   * @param maskedNodesMap 掩码节点映射
   * @param originalPath 原始文件路径
   * @returns 保存的文件路径
   */
  private async saveMaskedNodesMap(
    maskedNodesMap: Map<string, { id: string; originalContent: AstTypes.Ast }>,
    originalPath: string
  ): Promise<string> {
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const mapFilePath = path.join(this.logDir, `${originalFileName}_masked_map.json`);
    
    // 保存掩码节点映射
    await this.masker.saveMaskedNodesMap(mapFilePath);
    
    return mapFilePath;
  }
  
  /**
   * 翻译掩码后的文本
   * @param maskedText 掩码后的文本
   * @returns 翻译后的文本
   */
  private async translateMaskedText(maskedText: string): Promise<string> {
    // 创建日志文件路径
    const logFilePath = path.join(this.logDir, 'translation_log.txt');
    
    try {
      // 翻译文本
      return await this.openaiClient.translateLargeText(
        maskedText,
        this.options.targetLanguage,
        undefined, // 源语言可选
        4000,
        logFilePath
      );
    } catch (error) {
      console.error('翻译文本失败:', error);
      throw error;
    }
  }
  
  /**
   * 保存翻译后的文本
   * @param translatedText 翻译后的文本
   * @param originalPath 原始文件路径
   * @returns 保存的文件路径
   */
  private async saveTranslatedText(translatedText: string, originalPath: string): Promise<string> {
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const translatedFilePath = path.join(this.logDir, `${originalFileName}_translated.txt`);
    
    // 保存翻译后的文本
    await fs.writeFile(translatedFilePath, translatedText, 'utf8');
    console.log(`翻译后的文本已保存到: ${translatedFilePath}`);
    
    return translatedFilePath;
  }
  
  /**
   * 保存替换后的文本
   * @param replacedText 替换后的文本
   * @param originalPath 原始文件路径
   * @returns 保存的文件路径
   */
  private async saveReplacedText(replacedText: string, originalPath: string): Promise<string> {
    let outputFilePath;
    
    if (this.rootFile) {
      // 如果是项目中的根文件，保存到翻译后的目录中与根文件相同的路径
      outputFilePath = path.join(this.translatedDir, this.rootFile);
    } else {
      // 如果是单个文件，直接保存到翻译后的目录
      const originalFileName = path.basename(originalPath);
      outputFilePath = path.join(this.translatedDir, originalFileName);
    }
    
    // 确保输出目录存在
    await fs.mkdir(path.dirname(outputFilePath), { recursive: true });
    
    // 保存替换后的文本
    await fs.writeFile(outputFilePath, replacedText, 'utf8');
    console.log(`翻译后的LaTeX文件已保存到: ${outputFilePath}`);
    
    // 复制原始项目中的其他文件（非.tex文件）到翻译后的目录
    await this.copyNonTexFiles(this.originalDir, this.translatedDir);
    
    return outputFilePath;
  }
  
  /**
   * 复制所有非.tex文件
   * @param srcDir 源目录
   * @param destDir 目标目录
   */
  private async copyNonTexFiles(srcDir: string, destDir: string): Promise<void> {
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      
      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await this.copyNonTexFiles(srcPath, destPath);
      } else if (entry.isFile() && !isTexFile(entry.name)) {
        // 使用AST-Gen的isTexFile函数判断是否为TeX文件
        try {
          await fs.copyFile(srcPath, destPath);
        } catch (error) {
          console.warn(`无法复制文件 ${srcPath}:`, error);
        }
      }
    }
  }
} 