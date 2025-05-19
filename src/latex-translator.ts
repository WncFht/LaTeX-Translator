/**
 * latex-translator.ts
 * 
 * LaTeX翻译器主类，整合掩码、翻译和替换功能
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import config from 'config';
import { parseLatexProject, ProjectAST, AstTypes, serializeProjectAstToJson } from 'ast-gen';
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
    maskEnvironments?: string[];
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
  environments: string[];
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
      environments: ['equation', 'align', 'figure', 'table', 'algorithm'],
      commands: ['ref', 'cite', 'includegraphics', 'url'],
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
      maskEnvironments: options.maskingOptions?.maskEnvironments || configMaskOptions.environments,
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
  }
  
  /**
   * 翻译LaTeX文件或项目
   * @param inputPath 输入文件或目录路径
   */
  async translate(inputPath: string): Promise<string> {
    try {
      // 1. 解析LaTeX为AST
      console.log('正在解析LaTeX文件...');
      this.originalAst = await this.parseLatex(inputPath);
      
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
      
      // 8. 保存替换后的文本
      const outputFilePath = await this.saveReplacedText(replacedText, inputPath);
      
      console.log('翻译完成！');
      console.log(`输出文件: ${outputFilePath}`);
      
      return outputFilePath;
    } catch (error) {
      console.error('翻译过程中出错:', error);
      throw error;
    }
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
    // 创建输出目录
    await fs.mkdir(this.options.outputDir, { recursive: true });
    
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const astJsonPath = path.join(
      this.options.outputDir,
      `${originalFileName}_ast.json`
    );
    
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
    // 创建输出目录
    await fs.mkdir(this.options.outputDir, { recursive: true });
    
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const maskedFilePath = path.join(
      this.options.outputDir,
      `${originalFileName}_masked.txt`
    );
    
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
    // 创建输出目录
    await fs.mkdir(this.options.outputDir, { recursive: true });
    
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const mapFilePath = path.join(
      this.options.outputDir,
      `${originalFileName}_masked_map.json`
    );
    
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
    const logFilePath = path.join(
      this.options.outputDir,
      'translation_log.txt'
    );
    
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
    // 创建输出目录
    await fs.mkdir(this.options.outputDir, { recursive: true });
    
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const translatedFilePath = path.join(
      this.options.outputDir,
      `${originalFileName}_translated.txt`
    );
    
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
    // 创建输出目录
    await fs.mkdir(this.options.outputDir, { recursive: true });
    
    // 确定输出文件名
    const originalFileName = path.basename(originalPath, path.extname(originalPath));
    const originalExt = path.extname(originalPath);
    const outputFilePath = path.join(
      this.options.outputDir,
      `${originalFileName}_translated${originalExt}`
    );
    
    // 保存替换后的文本
    await fs.writeFile(outputFilePath, replacedText, 'utf8');
    console.log(`翻译后的LaTeX文件已保存到: ${outputFilePath}`);
    
    return outputFilePath;
  }
} 