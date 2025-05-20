/**
 * src/services/latex-translator.service.ts
 * 
 * 原 latex-translator.ts，核心的翻译流程编排服务。
 */

import * as path from 'path';
// import * as fsPromises from 'fs/promises'; // 由 FileService 处理
import { ProjectAST, Ast, serializeProjectAstToJson, findRootFile, ProjectFileAst } from 'ast-gen'; // findRootFile 可能仍需直接使用

// 导入服务
import { ParserService } from './parser_service';
import { MaskingService } from './masking_service';
import { TranslationService } from './translation_service';
import { ReplacementService } from './replacement_service';
import { ConfigService } from './config_service';
import { FileService } from './file_service';

// 导入类型
import type { TranslatorOptions, MaskingOptions, FileTranslationResult, OpenAIConfig } from '../types';
import type { Dirent } from 'fs';

// 导入工具函数
import * as LatexUtils from '../utils/latex.utils'; // 使用命名空间导入

export class LatexTranslatorService { // 重命名此类
  private options: Required<Pick<TranslatorOptions, 'targetLanguage' | 'saveIntermediateFiles' | 'outputDir'> & { 
    maskingOptions: Required<MaskingOptions>; 
    sourceLanguage: string | undefined;
  }>;
  
  // 注入的服务实例
  private parserService: ParserService;
  private maskingService: MaskingService;
  private translationService: TranslationService;
  // ReplacementService 是在需要时根据 maskedNodesMap 动态创建的，因此不作为构造函数注入的长期成员
  private configService: ConfigService;
  private fileService: FileService;

  // 项目状态变量
  private originalAst: ProjectAST | null;
  private projectDir: string;
  private originalDir: string;
  private translatedDir: string;
  private logDir: string;
  private rootFile: string | null;
  private processedFiles: Set<string>;
  private inputPathRootAbsolute!: string;
  
  constructor(options: TranslatorOptions = {}) { // 构造函数接收用户传入的选项
    // 获取服务实例 (这里使用单例模式，也可以改为真正的依赖注入)
    this.configService = ConfigService.getInstance();
    this.fileService = FileService.getInstance();
    this.parserService = new ParserService(); // ParserService 内部也用 FileService 单例

    // 合并配置
    const defaultTranslatorOptions = this.configService.getDefaultTranslatorOptions();
    const finalMaskingOptions: Required<MaskingOptions> = {
      ...defaultTranslatorOptions.maskingOptions,
      ...(options.maskingOptions || {}),
      regularEnvironments: options.maskingOptions?.regularEnvironments || defaultTranslatorOptions.maskingOptions.regularEnvironments,
      mathEnvironments: options.maskingOptions?.mathEnvironments || defaultTranslatorOptions.maskingOptions.mathEnvironments,
      maskCommands: options.maskingOptions?.maskCommands || defaultTranslatorOptions.maskingOptions.maskCommands,
    };

    this.options = {
      targetLanguage: options.targetLanguage || defaultTranslatorOptions.targetLanguage,
      sourceLanguage: options.sourceLanguage || defaultTranslatorOptions.sourceLanguage,
      saveIntermediateFiles: options.saveIntermediateFiles !== undefined 
        ? options.saveIntermediateFiles 
        : defaultTranslatorOptions.saveIntermediateFiles,
      outputDir: options.outputDir || defaultTranslatorOptions.outputDir,
      maskingOptions: finalMaskingOptions
    };
    
    // MaskingService 需要最终的掩码选项
    this.maskingService = new MaskingService(this.options.maskingOptions);
    // TranslationService 需要 OpenAI 配置，可以从传入的 options 或 ConfigService 获取
    const openAIConfigToUse = options.openaiConfig || this.configService.getOpenAIConfig();
    this.translationService = new TranslationService(openAIConfigToUse);
        
    this.originalAst = null;
    this.projectDir = '';
    this.originalDir = '';
    this.translatedDir = '';
    this.logDir = '';
    this.rootFile = null;
    this.processedFiles = new Set<string>();
  }
  
  async translate(inputPath: string): Promise<string> {
    try {
      const absInputPath = path.resolve(inputPath);
      const inputStatForRoot = await this.fileService.stat(absInputPath);
      if (inputStatForRoot.isDirectory()) {
        this.inputPathRootAbsolute = absInputPath;
      } else {
        this.inputPathRootAbsolute = path.dirname(absInputPath);
      }

      await this.setupProjectDirectories(inputPath);
      
      console.log('正在解析LaTeX项目...');
      this.originalAst = await this.parserService.parse(inputPath);
      
      await this.copyOriginalProject(inputPath);
      
      if (this.options.saveIntermediateFiles) { // 根据选项决定是否保存
        await this.saveAstAsJson(this.originalAst, inputPath);
      }
      
      const inputStat = await this.fileService.stat(inputPath);
      if (inputStat.isFile()) {
        console.log(`处理单个文件: ${inputPath}`);
        return await this.processSingleFile(inputPath, this.originalAst as ProjectAST); // 断言 ast 不为 null
      }
      
      console.log('处理多文件项目...');
      const translatedFilesResults = await this.processMultiFileProject(this.originalAst as ProjectAST); //断言 ast 不为 null
      
      await this.copyNonTexFiles(this.originalDir, this.translatedDir);
      
      if (this.rootFile) {
        const rootFilePath = path.join(this.translatedDir, this.rootFile);
        console.log(`翻译完成！根文件: ${rootFilePath}`);
        return rootFilePath;
      } else {
        const translatedFilesStr = translatedFilesResults.map(f => f.translatedFilePath).join('\n');
        console.log(`翻译完成！已翻译文件:\n${translatedFilesStr}`);
        return this.translatedDir;
      }
    } catch (error) {
      console.error('翻译过程中出错:', error); // 中文注释
      throw error;
    }
  }
  
  private async processMultiFileProject(ast: ProjectAST): Promise<FileTranslationResult[]> {
    const results: FileTranslationResult[] = [];
    if (!ast.files || !Array.isArray(ast.files) || ast.files.length === 0) {
      console.warn('项目AST中没有找到文件列表');
      return [];
    }
    console.log(`项目包含 ${ast.files.length} 个文件，开始递归处理...`);
    let orderedFiles = [...ast.files];
    if (ast.rootFilePath) {
      const rootFileIndex = orderedFiles.findIndex(file => file.filePath === ast.rootFilePath);
      if (rootFileIndex > -1) {
        const [rootFileAst] = orderedFiles.splice(rootFileIndex, 1);
        orderedFiles.unshift(rootFileAst);
        console.log(`根文件 ${ast.rootFilePath} 将被首先处理`);
      }
    }
    for (const fileAst of orderedFiles) {
      if (this.processedFiles.has(fileAst.filePath)) {
        console.log(`文件 ${fileAst.filePath} 已处理，跳过`);
        continue;
      }
      console.log(`正在处理文件: ${fileAst.filePath}`);
      try {
        const relativeFilePath = LatexUtils.getRelativePath(fileAst.filePath, this.inputPathRootAbsolute);
        const originalFilePath = path.join(this.originalDir, relativeFilePath);
        const singleFileAst: ProjectAST = {
          files: [fileAst],
          macros: ast.macros,
          _detailedMacros: ast._detailedMacros,
          errors: ast.errors,
          rootFilePath: fileAst.filePath
        };
        console.log(`正在掩码文件: ${relativeFilePath}`);
        const { maskedText, maskedNodesMap } = await this.maskingService.maskAst(singleFileAst);
        
        let maskedFilePath: string | undefined;
        if (this.options.saveIntermediateFiles) {
          maskedFilePath = await this.saveMaskedText(maskedText, relativeFilePath);
          await this.saveMaskedNodesMap(maskedNodesMap, relativeFilePath);
        }
        
        console.log(`正在翻译文件: ${relativeFilePath}`);
        const translatedText = await this.translationService.translateLargeText(
            maskedText, 
            this.options.targetLanguage, 
            this.options.sourceLanguage, 
            4000, 
            this.options.saveIntermediateFiles ? path.join(this.logDir, 'translation_log.txt') : undefined
        );
        
        let translatedTextFilePath: string | undefined;
        if (this.options.saveIntermediateFiles) {
          translatedTextFilePath = await this.saveTranslatedText(translatedText, relativeFilePath);
        }
        
        console.log(`正在替换文件 ${relativeFilePath} 中的掩码节点...`);
        const replacer = new ReplacementService(maskedNodesMap);
        const replacedText = replacer.replaceTranslatedText(translatedText);
        const enhancedText = LatexUtils.addChineseSupport(replacedText);
        const translatedFilePath = path.join(this.translatedDir, relativeFilePath);
        await this.fileService.writeFile(translatedFilePath, enhancedText, 'utf8');
        console.log(`文件 ${relativeFilePath} 翻译完成，已保存到 ${translatedFilePath}`);
        this.processedFiles.add(fileAst.filePath);
        results.push({
          originalFilePath,
          translatedFilePath,
          maskedFilePath, // Might be undefined
          translatedTextFilePath // Might be undefined
        });
      } catch (error) {
        console.error(`处理文件 ${fileAst.filePath} 时出错:`, error);
      }
    }
    return results;
  }
  
  // getRelativeFilePath 已移至 LatexUtils.getRelativePath
  // ensureDirectoryExists 已由 FileService.writeFile 内部处理
  
  private async processSingleFile(filePath: string, ast: ProjectAST): Promise<string> {
    const fileName = path.basename(filePath);
    console.log(`处理单个文件: ${fileName}`);
    console.log('正在掩码AST...');
    const { maskedText, maskedNodesMap } = await this.maskingService.maskAst(ast);
    
    if (this.options.saveIntermediateFiles) {
      await this.saveMaskedText(maskedText, fileName);
      await this.saveMaskedNodesMap(maskedNodesMap, fileName);
    }
    
    console.log('正在翻译文本...');
    const translatedText = await this.translationService.translateLargeText(
        maskedText, 
        this.options.targetLanguage, 
        this.options.sourceLanguage, 
        4000, 
        this.options.saveIntermediateFiles ? path.join(this.logDir, 'translation_log.txt') : undefined
    );
    
    if (this.options.saveIntermediateFiles) {
      await this.saveTranslatedText(translatedText, fileName);
    }
    
    console.log('正在替换掩码节点...');
    const replacer = new ReplacementService(maskedNodesMap);
    const replacedText = replacer.replaceTranslatedText(translatedText);
    const enhancedText = LatexUtils.addChineseSupport(replacedText);
    const outputFilePath = path.join(this.translatedDir, fileName);
    await this.fileService.writeFile(outputFilePath, enhancedText, 'utf8');
    console.log(`翻译完成！输出文件: ${outputFilePath}`);
    return outputFilePath;
  }
  
  private async setupProjectDirectories(inputPath: string): Promise<void> {
    const resolvedInputPath = path.resolve(inputPath);
    const inputStats = await this.fileService.stat(resolvedInputPath);
    let projectName: string;
    if (inputStats.isDirectory()) {
      projectName = path.basename(resolvedInputPath); 
    } else {
      projectName = path.basename(resolvedInputPath, path.extname(resolvedInputPath)); 
    }
    this.projectDir = path.join(this.options.outputDir, projectName);
    this.originalDir = path.join(this.projectDir, 'original');
    this.translatedDir = path.join(this.projectDir, 'translated');
    this.logDir = path.join(this.projectDir, 'log');
    await this.fileService.mkdirRecursive(this.projectDir);
    await this.fileService.mkdirRecursive(this.originalDir);
    await this.fileService.mkdirRecursive(this.translatedDir);
    await this.fileService.mkdirRecursive(this.logDir);
    console.log(`项目目录已创建: ${this.projectDir}`);
  }
  
  private async copyOriginalProject(inputPath: string): Promise<void> {
    const inputStat = await this.fileService.stat(inputPath);
    if (inputStat.isFile()) {
      const fileName = path.basename(inputPath);
      const destPath = path.join(this.originalDir, fileName);
      await this.fileService.copyFile(inputPath, destPath);
      this.rootFile = fileName;
      console.log(`已复制原始文件: ${destPath}`);
    } else if (inputStat.isDirectory()) {
      await this.fileService.copyDirectoryRecursive(inputPath, this.originalDir);
      const absoluteRootFile = await findRootFile(this.originalDir); // ast-gen function
      if (absoluteRootFile) {
        this.rootFile = path.relative(this.originalDir, absoluteRootFile);
        console.log(`已复制原始项目到: ${this.originalDir}`);
        console.log(`根文件: ${this.rootFile}`);
      } else {
        console.warn('未找到根文件，请手动指定根文件');
      }
    }
  }
  
  // copyDirectory 方法已由 fileService.copyDirectoryRecursive 替代，所以移除此私有方法

  // addChineseSupport 已移至 LatexUtils
  // parseLatex 方法现在直接使用 this.parserService.parse
  
  private async saveAstAsJson(ast: ProjectAST | null, originalPath: string): Promise<string> {
    if (!ast) {
        const errorMessage = "AST 为空，无法保存为 JSON。"; // 中文注释
        console.error(errorMessage);
        throw new Error(errorMessage);
    }
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const astJsonPath = path.join(this.logDir, `${originalFileName}_ast.json`);
    const jsonContent = serializeProjectAstToJson(ast, true); 
    await this.fileService.writeFile(astJsonPath, jsonContent, 'utf8');
    console.log(`AST 已保存至: ${astJsonPath}`); // 中文注释
    return astJsonPath;
  }
  
  private async saveMaskedText(maskedText: string, fileIdentifier: string): Promise<string> {
    const safeIdentifier = fileIdentifier.replace(/[\/\\]/g, '_');
    const maskedFilePath = path.join(this.logDir, `${safeIdentifier}_masked.txt`);
    await this.fileService.writeFile(maskedFilePath, maskedText, 'utf8');
    console.log(`掩码后的文本已保存至: ${maskedFilePath}`); // 中文注释
    return maskedFilePath;
  }
  
  private async saveMaskedNodesMap(
    maskedNodesMap: Map<string, { id: string; originalContent: Ast.Ast }>,
    fileIdentifier: string
  ): Promise<string> {
    const safeIdentifier = fileIdentifier.replace(/[\/\\]/g, '_');
    const mapFilePath = path.join(this.logDir, `${safeIdentifier}_masked_map.json`);
    const maskedNodesObj: Record<string, any> = {};
    maskedNodesMap.forEach((node, key) => {
      maskedNodesObj[key] = {
        id: node.id,
        originalContent: node.originalContent 
      };
    });
    await this.fileService.writeFile(mapFilePath, JSON.stringify(maskedNodesObj, null, 2), 'utf8');
    console.log(`掩码节点映射已保存至: ${mapFilePath}`); // 中文注释
    return mapFilePath;
  }
  
  // translateMaskedText 方法已在上面，使用 this.translationService
  
  private async saveTranslatedText(translatedText: string, fileIdentifier: string): Promise<string> {
    const safeIdentifier = fileIdentifier.replace(/[\/\\]/g, '_');
    const translatedFilePath = path.join(this.logDir, `${safeIdentifier}_translated.txt`);
    await this.fileService.writeFile(translatedFilePath, translatedText, 'utf8');
    console.log(`翻译后的文本已保存至: ${translatedFilePath}`); // 中文注释
    return translatedFilePath;
  }
  
  private async copyNonTexFiles(srcDir: string, destDir: string): Promise<void> {
    const entries = await this.fileService.readdir(srcDir, { withFileTypes: true }) as Dirent[];
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        // 确保目标子目录存在，然后递归调用
        await this.fileService.mkdirRecursive(destPath); 
        await this.copyNonTexFiles(srcPath, destPath); 
      } else if (entry.isFile() && !LatexUtils.isTexFile(entry.name)) { // 使用 LatexUtils.isTexFile
        try {
          await this.fileService.copyFile(srcPath, destPath);
        } catch (error) {
          console.warn(`无法复制文件 ${srcPath}:`, error);
        }
      }
    }
  }
} 