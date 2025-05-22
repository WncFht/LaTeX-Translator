#!/usr/bin/env node
/**
 * cli.ts
 * 
 * 命令行接口，处理用户输入和参数
 */

import * as path from 'path';
// import config from 'config'; // No longer directly used, ConfigService handles it
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ParserService } from './services/parser_service'; 
import { LatexTranslatorService } from './services/latex-translator_service'; // 更新导入
import type { TranslatorOptions } from './types'; // OpenAIConfig, MaskingOptions 不再直接被CLI使用
import { ConfigService } from './services/config_service';
import log from './utils/logger'; // 引入日志服务

// 主函数
async function main() {
  const configService = ConfigService.getInstance(); // Get instance of ConfigService

  const argv = await yargs(hideBin(process.argv))
    .usage('用法: $0 <命令> [参数]')
    .option('log-level', {
      alias: 'L',
      describe: '设置日志输出级别 (silly, trace, debug, info, warn, error, fatal)',
      type: 'string',
      // default: undefined, // 默认值将由logger.ts中的ConfigService读取逻辑处理
      coerce: (arg: string) => { // 验证并转换日志级别
        const validLevels = ["silly", "trace", "debug", "info", "warn", "error", "fatal"];
        const numericLevel = parseInt(arg, 10);
        if (validLevels.includes(arg.toLowerCase())) {
          return arg.toLowerCase();
        } else if (!isNaN(numericLevel) && numericLevel >= 0 && numericLevel <=6) {
          return validLevels[numericLevel]; // 将数字转换为字符串名称
        }
        log.warn(`无效的日志级别参数: "${arg}". 将使用配置文件中的设置或默认设置。`);
        return undefined; // 返回undefined，以便后续逻辑可以使用默认值
      }
    })
    .command('parse <inputPath>', '解析LaTeX文件或项目为AST', (yargs) => {
      return yargs
        .positional('inputPath', {
          describe: 'LaTeX文件或项目目录的路径',
          type: 'string'
        })
        .option('o', {
          alias: 'output',
          describe: '输出JSON文件的路径',
          type: 'string',
          default: 'output.json' // This default is simple, can remain or move to ConfigService if complex
        })
        .option('p', {
          alias: 'pretty',
          describe: '美化JSON输出',
          type: 'boolean',
          default: false
        })
        .option('m', {
          alias: 'macros',
          describe: '包含自定义宏定义的JSON文件的路径',
          type: 'string' // No default, it's optional
        })
        .option('n', {
          alias: 'no-default-macros',
          describe: '不加载默认宏定义',
          type: 'boolean',
          default: false
        });
    }, async (argv) => {
      await handleParseCommand(argv);
    })
    .command('translate <inputPath>', '翻译LaTeX文件或项目', (yargs) => {
      return yargs
        .positional('inputPath', {
          describe: 'LaTeX文件或项目目录的路径',
          type: 'string'
        })
        .option('api-key', {
          describe: 'OpenAI API密钥',
          type: 'string',
          default: configService.getOpenAIConfig().apiKey || '', 
          defaultDescription: '配置文件中的值'
        })
        .option('base-url', {
          describe: 'OpenAI API基础URL',
          type: 'string',
          default: configService.getOpenAIConfig().baseUrl || 'https://api.openai.com/v1', 
          defaultDescription: '配置文件中的值'
        })
        .option('model', {
          describe: 'OpenAI模型',
          type: 'string',
          default: configService.getOpenAIConfig().model || 'gpt-3.5-turbo', 
          defaultDescription: '配置文件中的值'
        })
        .option('target-lang', {
          describe: '目标语言',
          type: 'string',
          default: configService.getDefaultTranslatorOptions().targetLanguage, 
          defaultDescription: '配置文件中的值'
        })
        .option('source-lang', {
          describe: '源语言',
          type: 'string',
          default: configService.getDefaultTranslatorOptions().sourceLanguage, 
          defaultDescription: '配置文件中的值'
        })
        .option('o', {
          alias: 'output-dir',
          describe: '输出基础目录（将在其中创建项目子目录）',
          type: 'string',
          default: configService.getDefaultTranslatorOptions().outputDir, 
          defaultDescription: '配置文件中的值'
        })
        .option('temp', {
          alias: 'temperature',
          describe: '模型温度参数 (0-1)',
          type: 'number',
          default: configService.getOpenAIConfig().temperature ?? 0.3, // Use ?? for potentially undefined values from getOpenAIConfig
          defaultDescription: '配置文件中的值'
        })
        .option('mask-env', {
          describe: '要掩码的普通环境，用逗号分隔',
          type: 'string',
          defaultDescription: '配置文件中的值' // Default comes from merged options in LaTeXTranslator constructor
        })
        .option('mask-math-env', {
          describe: '要掩码的数学环境，用逗号分隔',
          type: 'string',
          defaultDescription: '配置文件中的值'
        })
        .option('mask-cmd', {
          describe: '要掩码的命令，用逗号分隔',
          type: 'string',
          defaultDescription: '配置文件中的值'
        })
        .option('no-mask-math', {
          describe: '不掩码数学公式',
          type: 'boolean',
          default: !configService.getDefaultTranslatorOptions().maskingOptions.maskInlineMath, 
          defaultDescription: '配置文件中的值'
        })
        .option('bypass-llm', { // 新增 bypass-llm 选项
          describe: '跳过LLM翻译，直接使用掩码文本 (用于调试)',
          type: 'boolean',
          // 默认值将由 TranslatorOptions 内部或 ConfigService 处理，这里不设置，以便区分用户是否明确传入
          defaultDescription: '配置文件中的值 (translation.bypassLLMTranslation)'
        });
    }, async (argv) => {
      await handleTranslateCommand(argv);
    })
    .demandCommand(1, '请指定一个命令: parse 或 translate')
    .help('h')
    .alias('h', 'help')
    .epilogue(`更多信息请参考README.md

翻译后的文件组织结构:
  output/
    <项目名>/         - 以输入文件或文件夹名称命名的项目目录
      original/       - 包含原始文件的目录
      translated/     - 包含翻译后文件的目录（可直接编译）
      log/            - 包含中间过程文件和日志的目录
`)
    .wrap(yargs.terminalWidth())
    .parseAsync(); // 使用 parseAsync 来获取 argv

  // 在命令处理前，根据命令行参数更新日志级别
  if (argv.logLevel) {
    const logLevelMap: { [key: string]: number } = {
      silly: 0, trace: 1, debug: 2, info: 3, warn: 4, error: 5, fatal: 6,
    };
    const newMinLevel = logLevelMap[argv.logLevel as string];
    if (newMinLevel !== undefined) {
      log.settings.minLevel = newMinLevel;
      log.debug(`通过命令行参数将日志级别设置为: ${argv.logLevel} (级别代码: ${newMinLevel})`);
    }
  }

  // 原来的命令分发逻辑会基于 argv 执行
  // yargs 在这里已经处理了命令的执行，我们不需要再次手动调用 handleParseCommand 或 handleTranslateCommand
  // 如果命令没有被 yargs 正确路由和执行，这里的结构可能需要调整
  // 但通常 yargs(hideBin(process.argv)).command(...).parse() 会处理命令执行
}

/**
 * 处理解析命令
 * @param argv 命令行参数
 */
async function handleParseCommand(argv: any): Promise<void> {
  // argv 中现在也包含了 logLevel (如果被设置)
  const inputPath = argv.inputPath as string;
  const outputPath = path.resolve(argv.output as string);
  const parser = new ParserService(); // 实例化 ParserService
  try {
    await parser.parseAndSave(inputPath, outputPath, {
      pretty: argv.pretty as boolean,
      macrosFile: argv.macros as string | undefined,
      loadDefaultMacros: !(argv['no-default-macros'] as boolean)
    });
    log.debug(`AST已成功保存到: ${outputPath}`);
    log.info('解析处理完成！');
  } catch (error) {
    log.error('解析处理过程中发生错误:', error);
    process.exit(1);
  }
}

/**
 * 处理翻译命令
 * @param argv 命令行参数
 */
async function handleTranslateCommand(argv: any): Promise<void> {
  try {
    // 构造 TranslatorOptions，这是传递给 LatexTranslatorService 的选项对象
    const translatorOptions: TranslatorOptions = {
      openaiConfig: { // 从 argv 直接构造 OpenAIConfig
        apiKey: argv['api-key'] as string,
        baseUrl: argv['base-url'] as string,
        model: argv.model as string,
        temperature: argv.temperature as number
      },
      targetLanguage: argv['target-lang'] as string,
      sourceLanguage: argv['source-lang'] as string | undefined,
      outputDir: argv['output-dir'] as string,
      // maskingOptions 将由用户命令行参数或 ConfigService 的默认值（在 LatexTranslatorService 内部处理）提供
      // 这里仅传递用户显式设置的掩码选项
      maskingOptions: {},
      // 如果命令行中指定了 bypassLLMTranslation，则使用它的值
      bypassLLMTranslation: argv['bypass-llm'] as boolean | undefined 
    };

    if (argv['mask-env']) {
      translatorOptions.maskingOptions!.regularEnvironments = 
        (argv['mask-env'] as string).split(',').map((env: string) => env.trim());
    }
    if (argv['mask-math-env']) {
      translatorOptions.maskingOptions!.mathEnvironments = 
        (argv['mask-math-env'] as string).split(',').map((env: string) => env.trim());
    }
    if (argv['mask-cmd']) {
      translatorOptions.maskingOptions!.maskCommands = 
        (argv['mask-cmd'] as string).split(',').map((cmd: string) => cmd.trim());
    }
    if (argv['no-mask-math'] !== undefined) {
      // 确保 maskingOptions 存在
      if (!translatorOptions.maskingOptions) translatorOptions.maskingOptions = {};
      translatorOptions.maskingOptions!.maskInlineMath = !argv['no-mask-math'];
      translatorOptions.maskingOptions!.maskDisplayMath = !argv['no-mask-math'];
    }
    
    const translator = new LatexTranslatorService(translatorOptions); // 实例化新的 Service
    const outputPath = await translator.translate(argv.inputPath as string);
    
    log.info('\n翻译完成！');
    log.info(`项目根目录: ${path.dirname(outputPath)}`);
    log.info(`翻译后文件: ${outputPath}`);
    log.info('你可以在翻译后的目录中直接编译LaTeX文件');
    
  } catch (error) {
    log.error('翻译过程中出错:', error);
    process.exit(1);
  }
}

// 执行主函数
main().catch(error => {
  log.error('未处理的错误:', error);
  process.exit(1);
}); 