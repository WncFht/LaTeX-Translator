#!/usr/bin/env node
/**
 * cli.ts
 * 
 * 命令行接口，处理用户输入和参数
 */

import * as path from 'path';
import config from 'config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { Translator } from './translator';
import { LaTeXTranslator, TranslatorOptions } from './latex-translator';
import { ParserOptions } from 'ast-gen';

// 从配置文件获取默认值，检查配置项是否存在的安全方法
const getConfigOrDefault = <T>(path: string, defaultValue: T): T => {
  try {
    return config.get<T>(path);
  } catch (error) {
    return defaultValue;
  }
};

// 主函数
async function main() {
  // 解析命令行参数
  await yargs(hideBin(process.argv))
    .usage('用法: $0 <命令> [参数]')
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
          default: 'output.json'
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
          type: 'string'
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
          default: getConfigOrDefault('openai.apiKey', ''),
          defaultDescription: '配置文件中的值'
        })
        .option('base-url', {
          describe: 'OpenAI API基础URL',
          type: 'string',
          default: getConfigOrDefault('openai.baseUrl', 'https://api.openai.com/v1'),
          defaultDescription: '配置文件中的值'
        })
        .option('model', {
          describe: 'OpenAI模型',
          type: 'string',
          default: getConfigOrDefault('openai.model', 'gpt-3.5-turbo'),
          defaultDescription: '配置文件中的值'
        })
        .option('target-lang', {
          describe: '目标语言',
          type: 'string',
          default: getConfigOrDefault('translation.defaultTargetLanguage', '简体中文'),
          defaultDescription: '配置文件中的值'
        })
        .option('source-lang', {
          describe: '源语言',
          type: 'string',
          default: getConfigOrDefault('translation.defaultSourceLanguage', undefined),
          defaultDescription: '配置文件中的值'
        })
        .option('o', {
          alias: 'output-dir',
          describe: '输出目录',
          type: 'string',
          default: getConfigOrDefault('output.defaultOutputDir', './output'),
          defaultDescription: '配置文件中的值'
        })
        .option('temp', {
          alias: 'temperature',
          describe: '模型温度参数 (0-1)',
          type: 'number',
          default: getConfigOrDefault('openai.temperature', 0.3),
          defaultDescription: '配置文件中的值'
        })
        .option('mask-env', {
          describe: '要掩码的环境，用逗号分隔',
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
          default: !getConfigOrDefault('translation.maskOptions.maskInlineMath', true),
          defaultDescription: '配置文件中的值'
        });
    }, async (argv) => {
      await handleTranslateCommand(argv);
    })
    .demandCommand(1, '请指定一个命令: parse 或 translate')
    .help('h')
    .alias('h', 'help')
    .epilogue('更多信息请参考README.md')
    .wrap(yargs.terminalWidth())
    .parse();
}

/**
 * 处理解析命令
 * @param argv 命令行参数
 */
async function handleParseCommand(argv: any): Promise<void> {
  const inputPath = argv.inputPath as string;
  const outputPath = path.resolve(argv.output as string);

  // 创建翻译器实例
  const translator = new Translator();

  try {
    // 解析并保存
    await translator.parseAndSave(inputPath, outputPath, {
      pretty: argv.pretty as boolean,
      macrosFile: argv.macros as string | undefined,
      loadDefaultMacros: !(argv['no-default-macros'] as boolean)
    });
    
    console.log(`AST已保存到: ${outputPath}`);
    console.log('处理完成！');
  } catch (error) {
    console.error('处理过程中出错:', error);
    process.exit(1);
  }
}

/**
 * 处理翻译命令
 * @param argv 命令行参数
 */
async function handleTranslateCommand(argv: any): Promise<void> {
  try {
    // 准备翻译器选项
    const translatorOptions: TranslatorOptions = {
      openaiConfig: {
        apiKey: argv['api-key'] as string,
        baseUrl: argv['base-url'] as string,
        model: argv.model as string,
        temperature: argv.temperature as number
      },
      targetLanguage: argv['target-lang'] as string,
      sourceLanguage: argv['source-lang'] as string | undefined,
      outputDir: argv['output-dir'] as string,
      maskingOptions: {}
    };

    // 获取掩码环境和命令（如果提供）
    if (argv['mask-env']) {
      translatorOptions.maskingOptions!.maskEnvironments = 
        (argv['mask-env'] as string).split(',').map((env: string) => env.trim());
    }

    if (argv['mask-cmd']) {
      translatorOptions.maskingOptions!.maskCommands = 
        (argv['mask-cmd'] as string).split(',').map((cmd: string) => cmd.trim());
    }

    // 设置是否掩码数学公式
    if (argv['no-mask-math'] !== undefined) {
      translatorOptions.maskingOptions!.maskInlineMath = !argv['no-mask-math'];
      translatorOptions.maskingOptions!.maskDisplayMath = !argv['no-mask-math'];
    }
    
    // 创建翻译器实例
    const translator = new LaTeXTranslator(translatorOptions);
    
    // 执行翻译
    await translator.translate(argv.inputPath as string);
    
  } catch (error) {
    console.error('翻译过程中出错:', error);
    process.exit(1);
  }
}

// 执行主函数
main().catch(error => {
  console.error('未处理的错误:', error);
  process.exit(1);
}); 