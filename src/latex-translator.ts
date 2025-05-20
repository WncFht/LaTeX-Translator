/**
 * latex-translator.ts
 * 
 * LaTeX翻译器主类，整合掩码、翻译和替换功能
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import config from 'config';
import { parseLatexProject, ProjectAST, AstTypes, serializeProjectAstToJson, findRootFile, isTexFile, ProjectFileAst } from 'ast-gen';
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

interface FileTranslationResult {
  originalFilePath: string;
  translatedFilePath: string;
  maskedFilePath?: string;
  translatedTextFilePath?: string;
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
  private processedFiles: Set<string>;
  private inputPathRootAbsolute!: string;
  
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
    this.processedFiles = new Set<string>();
  }
  
  /**
   * 翻译LaTeX文件或项目
   * @param inputPath 输入文件或目录路径
   */
  async translate(inputPath: string): Promise<string> {
    try {
      // 0. 创建项目目录结构
      // 解析输入路径，并存储其绝对路径作为项目根目录
      const absInputPath = path.resolve(inputPath);
      const inputStatForRoot = await fs.stat(absInputPath);
      if (inputStatForRoot.isDirectory()) {
        this.inputPathRootAbsolute = absInputPath;
      } else {
        this.inputPathRootAbsolute = path.dirname(absInputPath);
      }

      await this.setupProjectDirectories(inputPath);
      
      // 1. 解析LaTeX为AST
      console.log('正在解析LaTeX项目...');
      this.originalAst = await this.parseLatex(inputPath);
      
      // 复制原始项目到原始目录
      await this.copyOriginalProject(inputPath);
      
      // 1.1 保存AST为JSON文件
      const astJsonPath = await this.saveAstAsJson(this.originalAst, inputPath);
      
      // 如果是单个文件，直接处理
      const inputStat = await fs.stat(inputPath);
      if (inputStat.isFile()) {
        console.log(`处理单个文件: ${inputPath}`);
        return await this.processSingleFile(inputPath, this.originalAst);
      }
      
      // 2. 处理多文件项目
      console.log('处理多文件项目...');
      const translatedFiles = await this.processMultiFileProject(this.originalAst);
      
      // 3. 复制非.tex文件
      await this.copyNonTexFiles(this.originalDir, this.translatedDir);
      
      // 返回根文件路径（如果存在）
      if (this.rootFile) {
        const rootFilePath = path.join(this.translatedDir, this.rootFile);
        console.log(`翻译完成！根文件: ${rootFilePath}`);
        return rootFilePath;
      } else {
        const translatedFilesStr = translatedFiles.map(f => f.translatedFilePath).join('\n');
        console.log(`翻译完成！已翻译文件:\n${translatedFilesStr}`);
        return this.translatedDir;
      }
    } catch (error) {
      console.error('翻译过程中出错:', error);
      throw error;
    }
  }
  
  /**
   * 处理多文件项目
   * @param ast 项目AST
   * @returns 翻译结果数组
   */
  private async processMultiFileProject(ast: ProjectAST): Promise<FileTranslationResult[]> {
    // 这个数组用来存储每个文件的翻译结果
    const results: FileTranslationResult[] = [];
    
    // 检查AST是否包含文件列表
    if (!ast.files || !Array.isArray(ast.files) || ast.files.length === 0) {
      console.warn('项目AST中没有找到文件列表');
      return [];
    }
    
    console.log(`项目包含 ${ast.files.length} 个文件，开始递归处理...`);
    
    // 找到根文件，并确保它首先被处理
    let orderedFiles = [...ast.files];
    if (ast.rootFilePath) {
      const rootFileIndex = orderedFiles.findIndex(file => 
        file.filePath === ast.rootFilePath);
      
      if (rootFileIndex > -1) {
        // 将根文件移到数组的开头
        const [rootFile] = orderedFiles.splice(rootFileIndex, 1);
        orderedFiles.unshift(rootFile);
        console.log(`根文件 ${ast.rootFilePath} 将被首先处理`);
      }
    }
    
    // 对每个文件进行处理
    for (const fileAst of orderedFiles) {
      // 检查文件是否已处理
      if (this.processedFiles.has(fileAst.filePath)) {
        console.log(`文件 ${fileAst.filePath} 已处理，跳过`);
        continue;
      }
      
      console.log(`正在处理文件: ${fileAst.filePath}`);
      
      try {
        // 计算相对于原始目录的路径
        const relativeFilePath = this.getRelativeFilePath(fileAst.filePath);
        
        // 原始文件的路径
        const originalFilePath = path.join(this.originalDir, relativeFilePath);
        
        // 处理单个文件
        const fileContent = await fs.readFile(originalFilePath, 'utf8');
        
        // 创建用于该文件的特定AST对象
        const singleFileAst: ProjectAST = {
          files: [fileAst],
          macros: ast.macros,
          _detailedMacros: ast._detailedMacros,
          errors: ast.errors,
          rootFilePath: fileAst.filePath
        };
        
        // 2. 掩码AST
        console.log(`正在掩码文件: ${relativeFilePath}`);
        const { maskedText, maskedNodesMap } = await this.masker.maskAst(singleFileAst);
        
        // 3. 保存掩码后的文本
        const maskedFilePath = await this.saveMaskedText(maskedText, relativeFilePath);
        
        // 4. 保存掩码节点映射
        const maskedNodesMapPath = await this.saveMaskedNodesMap(maskedNodesMap, relativeFilePath);
        
        // 5. 翻译掩码后的文本
        console.log(`正在翻译文件: ${relativeFilePath}`);
        const translatedText = await this.translateMaskedText(maskedText);
        
        // 6. 保存翻译后的文本
        const translatedTextFilePath = await this.saveTranslatedText(translatedText, relativeFilePath);
        
        // 7. 替换掩码节点
        console.log(`正在替换文件 ${relativeFilePath} 中的掩码节点...`);
        const replacer = new Replacer(maskedNodesMap);
        const replacedText = replacer.replaceTranslatedText(translatedText);
        
        // 8. 为翻译后的文本添加中文支持
        const enhancedText = this.addChineseSupport(replacedText);
        
        // 9. 保存替换后的文本
        const translatedFilePath = path.join(this.translatedDir, relativeFilePath);
        await this.ensureDirectoryExists(path.dirname(translatedFilePath));
        await fs.writeFile(translatedFilePath, enhancedText, 'utf8');
        
        console.log(`文件 ${relativeFilePath} 翻译完成，已保存到 ${translatedFilePath}`);
        
        // 将此文件添加到处理过的文件集合中
        this.processedFiles.add(fileAst.filePath);
        
        // 添加到结果数组
        results.push({
          originalFilePath,
          translatedFilePath,
          maskedFilePath,
          translatedTextFilePath
        });
      } catch (error) {
        console.error(`处理文件 ${fileAst.filePath} 时出错:`, error);
        // 继续处理下一个文件
      }
    }
    
    return results;
  }
  
  /**
   * 获取文件相对于原始目录的路径
   * @param fileAstAbsoluteFilePath 文件的绝对路径
   * @returns 相对路径
   */
  private getRelativeFilePath(fileAstAbsoluteFilePath: string): string {
    // Precondition: this.inputPathRootAbsolute is set and is the absolute path to the root of the project
    // that was passed to parseLatex and used as the source for copyOriginalProject.
    // fileAstAbsoluteFilePath is an absolute path to a file within that original project.

    if (!this.inputPathRootAbsolute) {
      console.error('CRITICAL: inputPathRootAbsolute was not set prior to calling getRelativeFilePath.');
      // Fallback behavior that might be problematic but prevents a crash:
      return path.basename(fileAstAbsoluteFilePath); 
    }

    const relativePath = path.relative(this.inputPathRootAbsolute, fileAstAbsoluteFilePath);

    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      console.warn(
        `File path ${fileAstAbsoluteFilePath} is not cleanly relative to project root ${this.inputPathRootAbsolute}. ` +
        `Calculated relative path: ${relativePath}. Falling back to basename.`
      );
      return path.basename(fileAstAbsoluteFilePath);
    }
    
    if (relativePath === '') {
        // This case can happen if fileAstAbsoluteFilePath is the same as inputPathRootAbsolute (e.g. a single file project where root is the file itself)
        // However, inputPathRootAbsolute is generally a directory. If it was a file, dirname was taken.
        // If relativePath is empty because fileAstAbsoluteFilePath IS inputPathRootAbsolute (directory), this is an edge case not typically expected for a *file* path.
        // For a file that is the project root (e.g. single file input), basename is appropriate.
        return path.basename(fileAstAbsoluteFilePath);
    }

    return relativePath;
  }
  
  /**
   * 确保目录存在
   * @param directory 目录路径
   */
  private async ensureDirectoryExists(directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true });
  }
  
  /**
   * 处理单个LaTeX文件
   * @param filePath 文件路径
   * @param ast 文件AST
   * @returns 翻译后的文件路径
   */
  private async processSingleFile(filePath: string, ast: ProjectAST): Promise<string> {
    const fileName = path.basename(filePath);
    console.log(`处理单个文件: ${fileName}`);
    
    // 2. 掩码AST
    console.log('正在掩码AST...');
    const { maskedText, maskedNodesMap } = await this.masker.maskAst(ast);
    
    // 3. 保存掩码后的文本
    const maskedFilePath = await this.saveMaskedText(maskedText, fileName);
    
    // 4. 保存掩码节点映射
    const maskedNodesMapPath = await this.saveMaskedNodesMap(maskedNodesMap, fileName);
    
    // 5. 翻译掩码后的文本
    console.log('正在翻译文本...');
    const translatedText = await this.translateMaskedText(maskedText);
    
    // 6. 保存翻译后的文本
    const translatedFilePath = await this.saveTranslatedText(translatedText, fileName);
    
    // 7. 替换掩码节点
    console.log('正在替换掩码节点...');
    const replacer = new Replacer(maskedNodesMap);
    const replacedText = replacer.replaceTranslatedText(translatedText);
    
    // 8. 为翻译后的文本添加中文支持
    const enhancedText = this.addChineseSupport(replacedText);
    
    // 9. 保存替换后的文本
    const outputFilePath = path.join(this.translatedDir, fileName);
    await fs.writeFile(outputFilePath, enhancedText, 'utf8');
    
    console.log(`翻译完成！输出文件: ${outputFilePath}`);
    
    return outputFilePath;
  }
  
  /**
   * 设置项目目录结构
   * @param inputPath 输入文件或目录路径
   */
  private async setupProjectDirectories(inputPath: string): Promise<void> {
    // 获取原始文件/文件夹名称作为项目名
    const resolvedInputPath = path.resolve(inputPath);
    const inputStats = await fs.stat(resolvedInputPath);
    let projectName: string;

    if (inputStats.isDirectory()) {
      projectName = path.basename(resolvedInputPath); // 如果是目录，使用完整的基础名
    } else {
      projectName = path.basename(resolvedInputPath, path.extname(resolvedInputPath)); // 如果是文件，移除扩展名
    }
    
    // 创建项目目录
    this.projectDir = path.join(this.options.outputDir, projectName);
    
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
    
    // 检查文档是否包含documentclass
    if (texContent.includes('\\documentclass')) {
      // 在documentclass后添加ctex包
      return texContent.replace(
        /(\\documentclass(?:\[.*?\])?\{.*?\})/,
        '$1\n\\usepackage[UTF8]{ctex} % 添加中文支持'
      );
    }
    
    // 如果是被包含的文件，不包含documentclass，则直接返回
    return texContent;
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
   * @param fileIdentifier 文件标识符（文件名或相对路径）
   * @returns 保存的文件路径
   */
  private async saveMaskedText(maskedText: string, fileIdentifier: string): Promise<string> {
    // 去除扩展名，如果有的话
    const basename = path.basename(fileIdentifier, path.extname(fileIdentifier));
    // 创建包含路径信息的文件名，替换路径分隔符为下划线
    const safeIdentifier = fileIdentifier.replace(/[\/\\]/g, '_');
    
    // 确定输出文件名
    const maskedFilePath = path.join(this.logDir, `${safeIdentifier}_masked.txt`);
    
    // 保存掩码后的文本
    await fs.writeFile(maskedFilePath, maskedText, 'utf8');
    
    if (this.options.saveIntermediateFiles) {
      console.log(`掩码后的文本已保存到: ${maskedFilePath}`);
    }
    
    return maskedFilePath;
  }
  
  /**
   * 保存掩码节点映射
   * @param maskedNodesMap 掩码节点映射
   * @param fileIdentifier 文件标识符（文件名或相对路径）
   * @returns 保存的文件路径
   */
  private async saveMaskedNodesMap(
    maskedNodesMap: Map<string, { id: string; originalContent: AstTypes.Ast }>,
    fileIdentifier: string
  ): Promise<string> {
    // 创建包含路径信息的文件名，替换路径分隔符为下划线
    const safeIdentifier = fileIdentifier.replace(/[\/\\]/g, '_');
    
    // 确定输出文件名
    const mapFilePath = path.join(this.logDir, `${safeIdentifier}_masked_map.json`);
    
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
   * @param fileIdentifier 文件标识符（文件名或相对路径）
   * @returns 保存的文件路径
   */
  private async saveTranslatedText(translatedText: string, fileIdentifier: string): Promise<string> {
    // 创建包含路径信息的文件名，替换路径分隔符为下划线
    const safeIdentifier = fileIdentifier.replace(/[\/\\]/g, '_');
    
    // 确定输出文件名
    const translatedFilePath = path.join(this.logDir, `${safeIdentifier}_translated.txt`);
    
    // 保存翻译后的文本
    await fs.writeFile(translatedFilePath, translatedText, 'utf8');
    
    if (this.options.saveIntermediateFiles) {
      console.log(`翻译后的文本已保存到: ${translatedFilePath}`);
    }
    
    return translatedFilePath;
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