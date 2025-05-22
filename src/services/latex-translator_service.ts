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
import log from '../utils/logger'; // 引入日志服务

export class LatexTranslatorService { // 重命名此类
  private options: Required<Pick<TranslatorOptions, 'targetLanguage' | 'saveIntermediateFiles' | 'outputDir'> & { 
    maskingOptions: Required<MaskingOptions>; 
    sourceLanguage: string | undefined;
    bypassLLMTranslation: boolean; // 新增配置项
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
      maskingOptions: finalMaskingOptions,
      bypassLLMTranslation: options.bypassLLMTranslation !== undefined
        ? options.bypassLLMTranslation
        : defaultTranslatorOptions.bypassLLMTranslation, // 新增配置项读取
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
      
      log.info('正在解析LaTeX项目...');
      this.originalAst = await this.parserService.parse(inputPath);
      
      await this.copyOriginalProject(inputPath);
      
      if (this.options.saveIntermediateFiles) { // 根据选项决定是否保存
        log.debug(`原始AST将保存 (如果启用)。`); 
        await this.saveAstAsJson(this.originalAst, inputPath);
      }
      
      const inputStat = await this.fileService.stat(inputPath);
      if (inputStat.isFile()) {
        log.info(`开始处理单个文件: ${inputPath}`);
        return await this.processSingleFile(inputPath, this.originalAst as ProjectAST); // 断言 ast 不为 null
      }
      
      log.info(`开始处理多文件项目: ${inputPath}`);
      const translatedFilesResults = await this.processMultiFileProject(this.originalAst as ProjectAST); //断言 ast 不为 null
      
      await this.copyNonTexFiles(this.originalDir, this.translatedDir);
      
      if (this.rootFile) {
        const rootFilePath = path.join(this.translatedDir, this.rootFile);
        log.info(`翻译完成！项目根文件: ${rootFilePath}`);
        return rootFilePath;
      } else {
        const translatedFilesStr = translatedFilesResults.map(f => f.translatedFilePath).join('\n');
        log.info(`翻译完成！已翻译文件列表保存在输出目录中。查看: ${this.translatedDir}`);
        return this.translatedDir;
      }
    } catch (error) {
      log.error('翻译主流程发生错误:', error); // 中文提示
      throw error;
    }
  }
  
  private async processMultiFileProject(ast: ProjectAST): Promise<FileTranslationResult[]> {
    const results: FileTranslationResult[] = [];
    if (!ast.files || !Array.isArray(ast.files) || ast.files.length === 0) {
      log.warn('项目AST中未发现文件列表，无法处理多文件项目。');
      return [];
    }
    log.info(`项目共包含 ${ast.files.length} 个文件，开始逐个处理...`);
    let orderedFiles = [...ast.files];
    if (ast.rootFilePath) {
      const rootFileIndex = orderedFiles.findIndex(file => file.filePath === ast.rootFilePath);
      if (rootFileIndex > -1) {
        const [rootFileAst] = orderedFiles.splice(rootFileIndex, 1);
        orderedFiles.unshift(rootFileAst);
        log.debug(`项目根文件 ${ast.rootFilePath} 将被优先处理。`);
      }
    }
    for (const fileAst of orderedFiles) {
      if (this.processedFiles.has(fileAst.filePath)) {
        log.debug(`文件 ${fileAst.filePath} 此前已处理，本次跳过。`);
        continue;
      }
      log.info(`处理文件: ${fileAst.filePath}`); // 保留info级别，标记重要文件的开始
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
        log.debug(`开始掩码文件: ${relativeFilePath}`);
        const { maskedText, maskedNodesMap } = await this.maskingService.maskAst(singleFileAst);
        
        let maskedFilePath: string | undefined;
        if (this.options.saveIntermediateFiles) {
          log.debug(`掩码后文本将保存 (如果启用)。`);
          maskedFilePath = await this.saveMaskedText(maskedText, relativeFilePath);
          log.debug(`掩码节点映射将保存 (如果启用)。`);
          await this.saveMaskedNodesMap(maskedNodesMap, relativeFilePath);
        }
        
        let translatedText: string;
        if (this.options.bypassLLMTranslation) {
          log.info(`旁路LLM翻译（Bypass LLM translation）已启用，针对文件: ${relativeFilePath}。直接使用掩码文本。`);
          translatedText = maskedText; // 直接使用掩码文本
        } else {
          log.debug(`开始翻译文件: ${relativeFilePath}`);
          translatedText = await this.translationService.translateLargeText(
              maskedText, 
              this.options.targetLanguage, 
              this.options.sourceLanguage, 
              4000, 
              this.options.saveIntermediateFiles ? path.join(this.logDir, 'translation_log.txt') : undefined
          );
        }
        
        let translatedTextFilePath: string | undefined;
        if (this.options.saveIntermediateFiles) {
          log.debug(`翻译后文本将保存 (如果启用)。`);
          translatedTextFilePath = await this.saveTranslatedText(translatedText, relativeFilePath);
        }
        
        log.debug(`开始替换文件 ${relativeFilePath} 中的掩码节点...`);
        const replacer = new ReplacementService(maskedNodesMap);
        const replacedText = replacer.replaceTranslatedText(translatedText);
        const enhancedText = LatexUtils.addChineseSupport(replacedText);
        const translatedFilePath = path.join(this.translatedDir, relativeFilePath);
        await this.fileService.writeFile(translatedFilePath, enhancedText, 'utf8');
        log.info(`文件 ${relativeFilePath} 处理完成，已保存到: ${translatedFilePath}`);
        this.processedFiles.add(fileAst.filePath);
        results.push({
          originalFilePath,
          translatedFilePath,
          maskedFilePath, 
          translatedTextFilePath 
        });
      } catch (error) {
        log.error(`处理文件 ${fileAst.filePath} 时发生错误:`, error);
      }
    }
    return results;
  }
  
  private async processSingleFile(filePath: string, ast: ProjectAST): Promise<string> {
    const fileName = path.basename(filePath);
    log.info(`开始处理单文件: ${fileName}`); 
    log.debug(`开始掩码AST: ${fileName}`);
    const { maskedText, maskedNodesMap } = await this.maskingService.maskAst(ast);
    
    if (this.options.saveIntermediateFiles) {
      log.debug(`掩码后文本将保存 (如果启用): ${fileName}`);
      await this.saveMaskedText(maskedText, fileName);
      log.debug(`掩码节点映射将保存 (如果启用): ${fileName}`);
      await this.saveMaskedNodesMap(maskedNodesMap, fileName);
    }
    
    let translatedText: string;
    if (this.options.bypassLLMTranslation) {
      log.info(`旁路LLM翻译（Bypass LLM translation）已启用，针对文件: ${fileName}。直接使用掩码文本。`);
      translatedText = maskedText; 
    } else {
      log.debug(`开始翻译文本: ${fileName}`);
      translatedText = await this.translationService.translateLargeText(
          maskedText, 
          this.options.targetLanguage, 
          this.options.sourceLanguage, 
          4000, 
          this.options.saveIntermediateFiles ? path.join(this.logDir, 'translation_log.txt') : undefined
      );
    }
    
    if (this.options.saveIntermediateFiles) {
      log.debug(`翻译后文本将保存 (如果启用): ${fileName}`);
      await this.saveTranslatedText(translatedText, fileName);
    }
    
    log.debug(`开始替换掩码节点: ${fileName}`);
    const replacer = new ReplacementService(maskedNodesMap);
    const replacedText = replacer.replaceTranslatedText(translatedText);
    const enhancedText = LatexUtils.addChineseSupport(replacedText);
    const outputFilePath = path.join(this.translatedDir, fileName);
    await this.fileService.writeFile(outputFilePath, enhancedText, 'utf8');
    log.info(`单文件翻译完成！输出文件: ${outputFilePath}`);
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
    // 确保目录创建使用debug级别，除非这是一个关键的、用户需要知道的步骤
    log.debug(`项目主目录: ${this.projectDir}`);
    log.debug(`原始文件目录: ${this.originalDir}`);
    log.debug(`翻译文件目录: ${this.translatedDir}`);
    log.debug(`日志文件目录: ${this.logDir}`);
    await this.fileService.mkdirRecursive(this.projectDir);
    await this.fileService.mkdirRecursive(this.originalDir);
    await this.fileService.mkdirRecursive(this.translatedDir);
    await this.fileService.mkdirRecursive(this.logDir);
    log.info(`项目输出目录结构已创建于: ${this.projectDir}`);
  }
  
  private async copyOriginalProject(inputPath: string): Promise<void> {
    const inputStat = await this.fileService.stat(inputPath);
    if (inputStat.isFile()) {
      const fileName = path.basename(inputPath);
      const destPath = path.join(this.originalDir, fileName);
      await this.fileService.copyFile(inputPath, destPath);
      this.rootFile = fileName;
      log.info(`原始文件已复制到: ${destPath}`);
    } else if (inputStat.isDirectory()) {
      await this.fileService.copyDirectoryRecursive(inputPath, this.originalDir);
      const absoluteRootFile = await findRootFile(this.originalDir); 
      if (absoluteRootFile) {
        this.rootFile = path.relative(this.originalDir, absoluteRootFile);
        log.info(`原始项目已复制到: ${this.originalDir}`);
        log.info(`检测到项目根文件为: ${this.rootFile}`);
      } else {
        log.warn('在复制的项目中未自动找到根文件，请确保主文件被正确处理。');
      }
    }
  }
  
  private async saveAstAsJson(ast: ProjectAST | null, originalPath: string): Promise<string> {
    if (!ast) {
        const errorMessage = "AST 对象为空，无法保存为 JSON。"; 
        log.error(errorMessage);
        throw new Error(errorMessage);
    }
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const astJsonPath = path.join(this.logDir, `${originalFileName}_ast.json`);
    const jsonContent = serializeProjectAstToJson(ast, true); 
    await this.fileService.writeFile(astJsonPath, jsonContent, 'utf8');
    log.debug(`AST JSON 已保存至: ${astJsonPath}`); 
    return astJsonPath;
  }
  
  private async saveMaskedText(maskedText: string, fileIdentifier: string): Promise<string> {
    const safeIdentifier = fileIdentifier.replace(/[\/\\]/g, '_');
    const maskedFilePath = path.join(this.logDir, `${safeIdentifier}_masked.txt`);
    await this.fileService.writeFile(maskedFilePath, maskedText, 'utf8');
    log.debug(`掩码后的文本已保存至: ${maskedFilePath}`); 
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
    log.debug(`掩码节点映射已保存至: ${mapFilePath}`); 
    return mapFilePath;
  }
  
  private async saveTranslatedText(translatedText: string, fileIdentifier: string): Promise<string> {
    const safeIdentifier = fileIdentifier.replace(/[\/\\]/g, '_');
    const translatedFilePath = path.join(this.logDir, `${safeIdentifier}_translated.txt`);
    await this.fileService.writeFile(translatedFilePath, translatedText, 'utf8');
    log.debug(`翻译后的掩码文本已保存至: ${translatedFilePath}`); 
    return translatedFilePath;
  }
  
  private async copyNonTexFiles(srcDir: string, destDir: string): Promise<void> {
    log.debug(`开始从 ${srcDir} 向 ${destDir} 复制非 TeX 文件...`);
    const entries = await this.fileService.readdir(srcDir, { withFileTypes: true }) as Dirent[];
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        log.debug(`递归复制子目录: ${srcPath} 到 ${destPath}`);
        await this.fileService.mkdirRecursive(destPath); 
        await this.copyNonTexFiles(srcPath, destPath); 
      } else if (entry.isFile() && !LatexUtils.isTexFile(entry.name)) { 
        try {
          log.debug(`复制非 TeX 文件: ${srcPath} 到 ${destPath}`);
          await this.fileService.copyFile(srcPath, destPath);
        } catch (error) {
          log.warn(`无法复制非 TeX 文件 ${srcPath} 到 ${destPath}:`, error);
        }
      }
    }
    log.debug(`非 TeX 文件复制完成 (从 ${srcDir} 到 ${destDir}).`);
  }
} 