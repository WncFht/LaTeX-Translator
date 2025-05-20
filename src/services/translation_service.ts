/**
 * src/services/translation.service.ts
 * 
 * 原 openai-client.ts，负责与OpenAI API交互实现翻译功能
 */

// import * as fsPromises from 'fs/promises'; // FileService 已注入
// import * as path from 'path'; // path 可能仍需用于logPath处理，但主要文件操作由FileService完成
import { OpenAI } from 'openai';
// import config from 'config'; // ConfigService 将处理配置
import type { OpenAIConfig } from '../types';
import { FileService } from './file_service';
import { ConfigService } from './config_service'; // 引入 ConfigService

export class TranslationService { // 重命名此类
  private client: OpenAI;
  private config: Required<OpenAIConfig>;
  private fileService: FileService;
  private configService: ConfigService;

  constructor(customConfig?: Partial<OpenAIConfig>) {
    this.fileService = FileService.getInstance();
    this.configService = ConfigService.getInstance();

    const defaultConfig = this.configService.get<OpenAIConfig>('openai', {} as OpenAIConfig); // 获取整个openai配置块
    
    // 确保默认值被应用，特别是对于API Key等关键字段
    const effectiveDefaultConfig: Required<OpenAIConfig> = {
        apiKey: defaultConfig.apiKey || '', // 从配置文件获取，如果不存在则为空字符串
        baseUrl: defaultConfig.baseUrl || 'https://api.openai.com/v1',
        model: defaultConfig.model || 'gpt-3.5-turbo',
        temperature: defaultConfig.temperature ?? 0.3, // 使用 ?? 允许 0
        timeout: defaultConfig.timeout || 60000,
    };

    this.config = {
      ...effectiveDefaultConfig,
      ...customConfig
    };

    if (!this.config.apiKey) {
      console.warn('OpenAI API 密钥未配置。翻译尝试可能会失败。'); // 中文注释
    }
    
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      maxRetries: 3
    });
  }

  /**
   * 翻译文本
   * @param text 要翻译的文本
   * @param targetLang 目标语言
   * @param sourceLang 源语言(可选)
   * @returns 翻译后的文本
   */
  async translateText(
    text: string,
    targetLang: string,
    sourceLang?: string
  ): Promise<string> {
    try {
      const prompt = this.createTranslationPrompt(text, targetLang, sourceLang);
      
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的翻译器，专注于学术文档和LaTeX文件的翻译。保持专业术语的准确性，并确保输出格式与输入一致。' // 中文提示
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: this.config.temperature
      });

      const translatedText = response.choices[0]?.message?.content?.trim() || '';
      return translatedText;
    } catch (error) {
      console.error('翻译请求失败:', error); // 中文注释
      throw error;
    }
  }

  /**
   * 将文本分块并翻译
   * @param text 要翻译的文本
   * @param targetLang 目标语言
   * @param sourceLang 源语言(可选)
   * @param maxChunkSize 每个块的最大字符数
   * @param logPath 日志文件路径
   * @returns 翻译后的文本
   */
  async translateLargeText(
    text: string,
    targetLang: string,
    sourceLang?: string,
    maxChunkSize: number = 4000,
    logPath?: string
  ): Promise<string> {
    const chunks = this.splitTextIntoChunks(text, maxChunkSize);
    const translatedChunks: string[] = [];
    const logs: string[] = [];
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const logEntry = `[${new Date().toISOString()}] 翻译块 ${i+1}/${chunks.length} (${chunk.length} 字符)`; // 中文日志
      console.log(logEntry);
      logs.push(logEntry);
      try {
        const translatedChunk = await this.translateText(chunk, targetLang, sourceLang);
        translatedChunks.push(translatedChunk);
        const successLog = `[${new Date().toISOString()}] 块 ${i+1} 翻译成功`; // 中文日志
        console.log(successLog);
        logs.push(successLog);
      } catch (error) {
        const errorLog = `[${new Date().toISOString()}] 块 ${i+1} 翻译失败: ${error}`; // 中文日志
        console.error(errorLog);
        logs.push(errorLog);
        translatedChunks.push(chunk);
      }
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500)); // 避免API速率限制
      }
    }
    
    if (logPath) {
      await this.fileService.writeFile(logPath, logs.join('\n'), 'utf8');
    }
    return translatedChunks.join('\n\n');
  }
  
  /**
   * 创建翻译提示
   * @param text 要翻译的文本
   * @param targetLang 目标语言
   * @param sourceLang 源语言
   * @returns 翻译提示
   */
  private createTranslationPrompt(
    text: string,
    targetLang: string,
    sourceLang?: string
  ): string {
    let prompt = '';
    if (sourceLang) {
      prompt = `将以下${sourceLang}文本翻译成${targetLang}。请保持原始文本的格式，保留所有特殊标记和占位符(以 MASK_ 开头的文本)不变：\n\n${text}`;
    } else {
      prompt = `将以下文本翻译成${targetLang}。请保持原始文本的格式，保留所有特殊标记和占位符(以 MASK_ 开头的文本)不变：\n\n${text}`;
    }
    return prompt;
  }
  
  /**
   * 将文本分割为更小的块
   * @param text 要分割的文本
   * @param maxChunkSize 每个块的最大字符数
   * @returns 文本块数组
   */
  private splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = '';
    for (const paragraph of paragraphs) {
      if (paragraph.length > maxChunkSize) {
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
          if (sentence.length > maxChunkSize) {
            for (let i = 0; i < sentence.length; i += maxChunkSize) {
              chunks.push(sentence.slice(i, i + maxChunkSize));
            }
          } else if (currentChunk.length + sentence.length + 1 > maxChunkSize) {
            chunks.push(currentChunk);
            currentChunk = sentence;
          } else {
            currentChunk = currentChunk 
              ? `${currentChunk} ${sentence}` 
              : sentence;
          }
        }
      } 
      else if (currentChunk.length + paragraph.length + 2 > maxChunkSize) {
        chunks.push(currentChunk);
        currentChunk = paragraph;
      } 
      else {
        currentChunk = currentChunk 
          ? `${currentChunk}\n\n${paragraph}` 
          : paragraph;
      }
    }
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    return chunks;
  }
} 