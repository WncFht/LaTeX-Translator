/**
 * src/services/config.service.ts
 * 
 * 集中管理配置的读取和访问。
 */
import config from 'config';
import type { OpenAIConfig, MaskingOptions, ConfigMaskOptionsForDefaults } from '../types';
import log from '../utils/logger'; // 引入日志服务

export class ConfigService {
  private static instance: ConfigService;

  private constructor() { }

  public static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  public get<T>(path: string, defaultValue?: T): T {
    try {
      const value = config.get<T>(path);
      // config.get throws if path does not exist, so if defaultValue is provided,
      // this means we expect it to exist or have a fallback.
      // If it returns, it means the value was found.
      return value;
    } catch (error) {
      if (defaultValue !== undefined) {
        return defaultValue;
      }
      // If no defaultValue is provided and config.get throws, re-throw.
      // However, the original getConfigOrDefault in cli.ts always had a defaultValue.
      // So, this path might indicate a logic error if defaultValue is not passed when it should be.
      log.warn(`Configuration for path "${path}" not found and no default value provided.`);
      throw error; // Or handle more gracefully depending on strictness
    }
  }

  // Specific getters for commonly accessed configurations can be added here
  // This promotes type safety and centralizes knowledge of config paths

  public getOpenAIConfig(): Partial<OpenAIConfig> {
    const apiKey = this.get<string>('openai.apiKey', ''); // Default to empty, OpenAIClient will warn
    const baseUrl = this.get<string>('openai.baseUrl', undefined); // Let OpenAIClient handle default
    const model = this.get<string>('openai.model', undefined);
    const temperature = this.get<number>('openai.temperature', undefined);
    const timeout = this.get<number>('openai.timeout', undefined);

    const cfg: Partial<OpenAIConfig> = {};
    if (apiKey) cfg.apiKey = apiKey; // only add if non-empty, though constructor requires it
    if (baseUrl) cfg.baseUrl = baseUrl;
    if (model) cfg.model = model;
    if (temperature !== undefined) cfg.temperature = temperature;
    if (timeout !== undefined) cfg.timeout = timeout;
    return cfg;
  }

  public getDefaultTranslatorOptions(): {
    targetLanguage: string;
    sourceLanguage?: string;
    outputDir: string;
    maskingOptions: Required<MaskingOptions>;
    saveIntermediateFiles: boolean;
    bypassLLMTranslation: boolean;
  } {
    const defaultMaskOpts: Required<MaskingOptions> = {
      regularEnvironments: ['figure', 'table', 'algorithm', 'enumerate', 'itemize', 'tabular', 'lstlisting'],
      mathEnvironments: ['equation', 'align', 'gather', 'multline', 'eqnarray', 'matrix', 'pmatrix', 'bmatrix', 'array', 'aligned', 'cases', 'split'],
      maskCommands: ['ref', 'cite', 'eqref', 'includegraphics', 'url', 'label', 'textit', 'textbf', 'texttt', 'emph', 'href', 'caption', 'footnote', 'item'],
      maskInlineMath: true,
      maskDisplayMath: true,
      maskComments: false,
      maskPrefix: 'MASK_'
    };

    // Try to get complex object 'translation.maskOptions'
    // Fallback to defaultMaskOpts if not found or structure is different.
    const configMaskOptions = this.get<ConfigMaskOptionsForDefaults>('translation.maskOptions', defaultMaskOpts as any);

    const finalMaskingOptions: Required<MaskingOptions> = {
        regularEnvironments: configMaskOptions.regularEnvironments || defaultMaskOpts.regularEnvironments,
        mathEnvironments: configMaskOptions.mathEnvironments || defaultMaskOpts.mathEnvironments,
        maskCommands: configMaskOptions.maskCommands || defaultMaskOpts.maskCommands,
        maskInlineMath: configMaskOptions.maskInlineMath !== undefined ? configMaskOptions.maskInlineMath : defaultMaskOpts.maskInlineMath,
        maskDisplayMath: configMaskOptions.maskDisplayMath !== undefined ? configMaskOptions.maskDisplayMath : defaultMaskOpts.maskDisplayMath,
        maskComments: configMaskOptions.maskComments !== undefined ? configMaskOptions.maskComments : defaultMaskOpts.maskComments,
        maskPrefix: configMaskOptions.maskPrefix || defaultMaskOpts.maskPrefix,
    };

    return {
      targetLanguage: this.get<string>('translation.defaultTargetLanguage', '简体中文'),
      sourceLanguage: this.get<string| undefined>('translation.defaultSourceLanguage', undefined),
      outputDir: this.get<string>('output.defaultOutputDir', './output'),
      maskingOptions: finalMaskingOptions,
      saveIntermediateFiles: this.get<boolean>('translation.saveIntermediateFiles', true),
      bypassLLMTranslation: this.get<boolean>('translation.bypassLLMTranslation', true),
    };
  }
} 