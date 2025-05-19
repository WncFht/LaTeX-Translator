/**
 * openai-client.ts
 * 
 * OpenAI API客户端，使用官方OpenAI SDK调用翻译功能
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { OpenAI } from 'openai';
import config from 'config';

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  timeout?: number;
}

export class OpenAIClient {
  private client: OpenAI;
  private config: OpenAIConfig;

  constructor(customConfig?: Partial<OpenAIConfig>) {
    // 从配置文件获取默认值，使用try-catch处理可能的错误
    const getConfigOrDefault = <T>(path: string, defaultValue: T): T => {
      try {
        return config.get<T>(path);
      } catch (error) {
        return defaultValue;
      }
    };

    // 从配置文件获取默认设置
    const defaultConfig: OpenAIConfig = {
      apiKey: getConfigOrDefault('openai.apiKey', ''),
      baseUrl: getConfigOrDefault('openai.baseUrl', 'https://api.openai.com/v1'),
      model: getConfigOrDefault('openai.model', 'gpt-3.5-turbo'),
      temperature: getConfigOrDefault('openai.temperature', 0.3),
      timeout: getConfigOrDefault('openai.timeout', 60000)
    };

    // 合并自定义配置
    this.config = {
      ...defaultConfig,
      ...customConfig
    };

    // 初始化OpenAI客户端
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
            content: '你是一个专业的翻译器，专注于学术文档和LaTeX文件的翻译。保持专业术语的准确性，并确保输出格式与输入一致。'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: this.config.temperature
      });

      // 提取回复内容
      const translatedText = response.choices[0]?.message?.content?.trim() || '';
      return translatedText;
    } catch (error) {
      console.error('翻译请求失败:', error);
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
    // 分割文本为合适大小的块
    const chunks = this.splitTextIntoChunks(text, maxChunkSize);
    
    const translatedChunks: string[] = [];
    const logs: string[] = [];
    
    // 翻译每个块并记录日志
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      // 记录操作开始
      const logEntry = `[${new Date().toISOString()}] 翻译块 ${i+1}/${chunks.length} (${chunk.length} 字符)`;
      console.log(logEntry);
      logs.push(logEntry);
      
      try {
        const translatedChunk = await this.translateText(chunk, targetLang, sourceLang);
        translatedChunks.push(translatedChunk);
        
        // 记录成功
        const successLog = `[${new Date().toISOString()}] 块 ${i+1} 翻译成功`;
        console.log(successLog);
        logs.push(successLog);
      } catch (error) {
        // 记录错误
        const errorLog = `[${new Date().toISOString()}] 块 ${i+1} 翻译失败: ${error}`;
        console.error(errorLog);
        logs.push(errorLog);
        
        // 保留原文
        translatedChunks.push(chunk);
      }
      
      // 添加短暂延迟避免API限制
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // 保存日志
    if (logPath) {
      const logDir = path.dirname(logPath);
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(logPath, logs.join('\n'), 'utf8');
    }
    
    // 合并翻译后的块
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
    // 优先按段落分割
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      // 如果段落本身超过最大块大小，需要进一步分割
      if (paragraph.length > maxChunkSize) {
        // 先添加当前块
        if (currentChunk) {
          chunks.push(currentChunk);
          currentChunk = '';
        }
        
        // 按句子分割大段落
        const sentences = paragraph.split(/(?<=[.!?])\s+/);
        
        for (const sentence of sentences) {
          if (sentence.length > maxChunkSize) {
            // 极端情况：句子太长，按固定长度分割
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
      // 如果添加这个段落会超过块大小，开始新块
      else if (currentChunk.length + paragraph.length + 2 > maxChunkSize) {
        chunks.push(currentChunk);
        currentChunk = paragraph;
      } 
      // 否则添加到当前块
      else {
        currentChunk = currentChunk 
          ? `${currentChunk}\n\n${paragraph}` 
          : paragraph;
      }
    }
    
    // 添加最后一个块
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }
} 