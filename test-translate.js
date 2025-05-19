/**
 * 测试脚本：演示LaTeX翻译功能
 * 
 * 使用方法：
 * node test-translate.js <输入文件路径> [API密钥]
 * 
 * 如果不提供API密钥，将使用配置文件中的密钥
 * 
 * 例如：
 * node test-translate.js ../test_latex/example.tex
 * 或
 * node test-translate.js ../test_latex/example.tex sk-your-api-key
 */

const { LaTeXTranslator } = require('./dist/index');

async function main() {
  // 获取命令行参数
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: node test-translate.js <输入文件路径> [API密钥]');
    process.exit(1);
  }

  const inputPath = args[0];
  const apiKey = args[1]; // 可选参数，如果提供则覆盖配置文件中的值
  
  // 创建LaTeX翻译器实例
  // 如果提供了API密钥，则使用它覆盖配置文件中的值
  const translatorOptions = apiKey ? { 
    openaiConfig: {
      apiKey: apiKey 
    }
  } : {};
  
  const translator = new LaTeXTranslator(translatorOptions);
  
  try {
    console.log(`开始翻译文件: ${inputPath}`);
    const outputPath = await translator.translate(inputPath);
    console.log(`翻译完成！输出文件: ${outputPath}`);
  } catch (error) {
    console.error('翻译失败:', error);
  }
}

main().catch(error => {
  console.error('未捕获的错误:', error);
}); 