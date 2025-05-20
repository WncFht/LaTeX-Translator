/**
 * masker.ts
 * 
 * 负责从LaTeX AST中提取和掩码需要保护的内容
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ProjectAST,
  ProjectFileAst,
  AstTypes
} from 'ast-gen';

interface MaskingOptions {
  // 需要掩码的普通环境类型
  regularEnvironments?: string[];
  // 需要掩码的数学环境类型
  mathEnvironments?: string[];
  // 需要掩码的命令
  maskCommands?: string[];
  // 需要掩码的内联数学
  maskInlineMath?: boolean;
  // 需要掩码的行间数学
  maskDisplayMath?: boolean;
  // 是否掩码注释
  maskComments?: boolean;
  // 掩码前缀
  maskPrefix?: string;
}

interface MaskedNode {
  id: string;
  originalContent: AstTypes.Ast;
}

export class Masker {
  private options: MaskingOptions;
  private maskedNodes: Map<string, MaskedNode>;
  private maskCounter: number;
  
  constructor(options: MaskingOptions = {}) {
    // 默认选项
    this.options = {
      regularEnvironments: ['figure', 'table', 'algorithm', 'enumerate', 'itemize', 'tabular', 'lstlisting'],
      mathEnvironments: ['equation', 'align', 'gather', 'multline', 'eqnarray', 'matrix', 'pmatrix', 'bmatrix', 'array', 'aligned', 'cases', 'split'],
      maskCommands: ['ref', 'cite', 'eqref', 'includegraphics', 'url', 'label', 'textit', 'textbf', 'texttt', 'emph', 'href', 'caption', 'footnote', 'item'],
      maskInlineMath: true,
      maskDisplayMath: true,
      maskComments: false,
      maskPrefix: 'MASK_',
      ...options
    };
    
    this.maskedNodes = new Map();
    this.maskCounter = 0;
  }
  
  /**
   * 掩码AST并生成掩码后的文本
   * @param ast 项目AST
   * @returns 掩码后的文本
   */
  async maskAst(ast: ProjectAST): Promise<{
    maskedText: string;
    maskedNodesMap: Map<string, MaskedNode>;
  }> {
    // 重置状态
    this.maskedNodes = new Map();
    this.maskCounter = 0;
    
    // 处理每个文件
    let maskedText = '';
    
    for (const fileAst of ast.files) {
      // 掩码单个文件
      const fileMaskedText = this.maskFileAst(fileAst);
      if (maskedText) {
        maskedText += '\n\n';
      }
      maskedText += fileMaskedText;
    }
    
    return {
      maskedText,
      maskedNodesMap: this.maskedNodes
    };
  }
  
  /**
   * 掩码单个文件的AST
   * @param fileAst 文件AST
   * @returns 掩码后的文本
   */
  private maskFileAst(fileAst: ProjectFileAst): string {
    // 创建文本构建器
    let maskedText = '';
    
    // 处理根节点
    if (fileAst.ast && fileAst.ast.type === 'root' && fileAst.ast.content) {
      const rootContent = fileAst.ast.content;
      
      // 递归处理内容
      maskedText = this.processNodes(rootContent);
    }
    
    return maskedText;
  }
  
  /**
   * 处理节点数组
   * @param nodes 节点数组
   * @returns 处理后的文本
   */
  private processNodes(nodes: AstTypes.Ast[]): string {
    let result = '';
    
    for (const node of nodes) {
      if (!node) continue;
      
      // 如果node是数组，递归处理
      if (Array.isArray(node)) {
        result += this.processNodes(node);
        continue;
      }
      
      // 现在我们可以安全地访问node.type
      if (!node.type) continue;
      
      // 获取节点类型为字符串
      const nodeType = node.type.toString();
      
      switch (nodeType) {
        case 'string':
          // 直接添加文本
          result += (node as AstTypes.String).content;
          break;
          
        case 'whitespace':
          // 保持原始空白
          result += ' ';
          break;
          
        case 'parbreak':
          // 保持段落分隔
          result += '\n\n';
          break;
          
        case 'comment':
          // 处理注释
          result += this.processComment(node);
          break;
          
        case 'macro':
          // 处理宏命令
          result += this.processMacro(node as AstTypes.Macro);
          break;
          
        case 'environment':
          // 处理环境
          result += this.processEnvironment(node);
          break;
          
        case 'inlinemath':
          // 处理内联数学
          result += this.processInlineMath(node);
          break;
          
        case 'displaymath':
          // 处理行间数学
          result += this.processDisplayMath(node);
          break;
          
        case 'mathenv':
          // 处理数学环境（如align, equation等）
          result += this.processMathEnv(node);
          break;
          
        case 'verbatim':
          // 处理原始环境，如代码块
          result += this.processVerbatim(node);
          break;
          
        default:
          // 处理非标准类型（如math.inline、math.display等）
          if (nodeType === 'math.inline') {
            result += this.processInlineMath(node);
          } else if (nodeType === 'math.display') {
            result += this.processDisplayMath(node);
          } 
          // 递归处理其他类型的节点
          else if ('content' in node && Array.isArray(node.content)) {
            result += this.processNodes(node.content);
          } else if ('content' in node && typeof node.content === 'string') {
            result += node.content;
          }
      }
    }
    
    return result;
  }
  
  /**
   * 处理宏命令
   * @param node 宏命令节点
   * @returns 处理后的文本
   */
  private processMacro(node: AstTypes.Macro): string {
    // 检查是否需要掩码这个命令
    if (this.options.maskCommands && 
        this.options.maskCommands.includes(node.content)) {
      // 创建掩码ID
      const maskId = this.generateMaskId('CMD');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 特殊处理某些宏
    if (node.content === 'begin' || node.content === 'end') {
      return `\\${node.content}${this.processArgs(node.args || [])}`;
    }
    
    // 检查诸如\textbf、\textit等格式化命令
    const formattingCommands = ['textbf', 'textit', 'texttt', 'textrm', 'textsc', 'emph', 'underline', 'textcolor'];
    if (formattingCommands.includes(node.content)) {
      // 创建掩码ID
      const maskId = this.generateMaskId('FMT');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 对于其他宏，包括其参数
    return `\\${node.content}${this.processArgs(node.args || [])}`;
  }
  
  /**
   * 处理环境
   * @param node 环境节点
   * @returns 处理后的文本
   */
  private processEnvironment(node: AstTypes.Ast): string {
    // 确保node有env属性
    if (!('env' in node)) return '';
    
    // 获取环境名称，处理不同的数据结构
    let envName = '';
    const envAttr = (node as any).env;
    
    if (typeof envAttr === 'string') {
      envName = envAttr;
    } else if (typeof envAttr === 'object' && envAttr !== null) {
      if ('content' in envAttr) {
        envName = envAttr.content as string;
      } else if ('type' in envAttr && envAttr.type === 'string' && 'content' in envAttr) {
        envName = envAttr.content as string;
      }
    }
    
    // 如果无法获取环境名称，返回空字符串
    if (!envName) {
      console.warn('无法确定环境名称:', node);
      return '';
    }
    
    // 检查是否是数学环境且需要掩码
    const isMathEnv = this.options.mathEnvironments && this.options.mathEnvironments.includes(envName);
    
    if ((isMathEnv && this.options.maskDisplayMath) || 
        (this.options.regularEnvironments && this.options.regularEnvironments.includes(envName))) {
      // 创建掩码ID，为数学环境使用特殊前缀
      const maskId = this.generateMaskId(isMathEnv ? 'MATH_ENV' : 'ENV');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 处理环境头部
    let result = `\\begin{${envName}}`;
    
    // 添加可能的环境参数
    if ('args' in node && node.args && Array.isArray(node.args)) {
      result += this.processArgs(node.args);
    }
    
    // 处理环境内容
    if ('content' in node && node.content && Array.isArray(node.content)) {
      result += this.processNodes(node.content);
    }
    
    // 处理环境尾部
    result += `\\end{${envName}}`;
    
    return result;
  }
  
  /**
   * 处理内联数学
   * @param node 内联数学节点
   * @returns 处理后的文本
   */
  private processInlineMath(node: AstTypes.Ast): string {
    if (this.options.maskInlineMath) {
      // 创建掩码ID
      const maskId = this.generateMaskId('IMATH');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      // 使用显著的标记使掩码更明显
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 如果不掩码，返回原始内容
    let content = '';
    if ('content' in node && node.content && Array.isArray(node.content)) {
      content = this.processNodes(node.content);
    } else if ('content' in node && node.content && typeof node.content === 'string') {
      content = node.content as string;
    }
    return `$${content}$`;
  }
  
  /**
   * 处理行间数学
   * @param node 行间数学节点
   * @returns 处理后的文本
   */
  private processDisplayMath(node: AstTypes.Ast): string {
    if (this.options.maskDisplayMath) {
      // 创建掩码ID
      const maskId = this.generateMaskId('DMATH');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      // 使用显著的标记使掩码更明显
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 如果不掩码，返回原始内容
    let content = '';
    if ('content' in node && node.content && Array.isArray(node.content)) {
      content = this.processNodes(node.content);
    } else if ('content' in node && node.content && typeof node.content === 'string') {
      content = node.content as string;
    }
    
    // 根据节点属性返回适当的分隔符
    if ('env' in node && (
        (node as any).env === 'align' || 
        (node as any).env === 'equation' || 
        (node as any).isEnvPart
    )) {
      return content; // 对于环境的一部分，不添加分隔符
    }
    return `\\[${content}\\]`;
  }
  
  /**
   * 处理数学环境（如align, equation等）
   * @param node 数学环境节点
   * @returns 处理后的文本
   */
  private processMathEnv(node: AstTypes.Ast): string {
    // 确保node有env属性
    if (!('env' in node)) return '';
    
    // 获取环境名称，处理不同的数据结构
    let envName = '';
    const envAttr = (node as any).env;
    
    if (typeof envAttr === 'string') {
      envName = envAttr;
    } else if (typeof envAttr === 'object' && envAttr !== null) {
      if ('content' in envAttr) {
        envName = envAttr.content as string;
      } else if ('type' in envAttr && envAttr.type === 'string' && 'content' in envAttr) {
        envName = envAttr.content as string;
      }
    }
    
    // 如果无法获取环境名称，返回空字符串
    if (!envName) {
      console.warn('无法确定数学环境名称:', node);
      return '';
    }
    
    // 检查是否属于配置的数学环境
    const isMathEnv = this.options.mathEnvironments && this.options.mathEnvironments.includes(envName);
    
    // 对于数学环境，直接进行掩码处理
    if (isMathEnv && this.options.maskDisplayMath) {
      // 创建掩码ID
      const maskId = this.generateMaskId('MATH_ENV');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      // 使用显著的标记使掩码更明显
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 如果不掩码，处理环境内容
    let result = '';
    
    // 添加环境开始标记
    result += `\\begin{${envName}}`;
    
    // 添加可能的环境参数
    if ('args' in node && node.args && Array.isArray(node.args)) {
      result += this.processArgs(node.args);
    }
    
    // 处理环境内容
    if ('content' in node && node.content && Array.isArray(node.content)) {
      result += this.processNodes(node.content);
    }
    
    // 添加环境结束标记
    result += `\\end{${envName}}`;
    
    return result;
  }
  
  /**
   * 处理注释
   * @param node 注释节点
   * @returns 处理后的文本
   */
  private processComment(node: AstTypes.Ast): string {
    if (this.options.maskComments) {
      // 创建掩码ID
      const maskId = this.generateMaskId('COMMENT');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 如果不掩码，返回原始内容
    if ('content' in node && typeof node.content === 'string') {
      return `%${node.content}\n`;
    }
    
    return '';
  }
  
  /**
   * 处理参数
   * @param args 参数数组
   * @returns 处理后的文本
   */
  private processArgs(args: AstTypes.Ast[]): string {
    if (!args || !Array.isArray(args)) return '';
    
    let result = '';
    
    for (const arg of args) {
      if (!arg) continue;
      
      // 如果arg是数组，递归处理
      if (Array.isArray(arg)) {
        result += this.processArgs(arg);
        continue;
      }
      
      // 现在可以安全地访问arg.type
      if (!arg.type) continue;
      
      // 处理不同类型的参数
      if (arg.type === 'argument') {
        const argument = arg as AstTypes.Argument;
        const openMark = argument.openMark || '';
        const closeMark = argument.closeMark || '';
        
        if (argument.content && Array.isArray(argument.content)) {
          result += `${openMark}${this.processNodes(argument.content)}${closeMark}`;
        } else if (typeof argument.content === 'string') {
          result += `${openMark}${argument.content}${closeMark}`;
        } else {
          result += `${openMark}${closeMark}`;
        }
      }
    }
    
    return result;
  }
  
  /**
   * 生成唯一的掩码ID
   * @param prefix 前缀
   * @returns 掩码ID
   */
  private generateMaskId(prefix: string): string {
    this.maskCounter++;
    return `${prefix}_${this.maskCounter.toString().padStart(4, '0')}`;
  }
  
  /**
   * 将掩码后的文本保存到文件
   * @param maskedText 掩码后的文本
   * @param outputPath 输出路径
   */
  async saveMaskedText(maskedText: string, outputPath: string): Promise<void> {
    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    // 写入文件
    await fs.writeFile(outputPath, maskedText, 'utf8');
    console.log(`掩码后的文本已保存到: ${outputPath}`);
  }
  
  /**
   * 将掩码节点映射保存到文件
   * @param maskedNodesMap 掩码节点映射
   * @param outputPath 输出路径
   */
  async saveMaskedNodesMap(outputPath: string): Promise<void> {
    // 将Map转换为对象
    const maskedNodesObj: Record<string, any> = {};
    this.maskedNodes.forEach((node, key) => {
      maskedNodesObj[key] = {
        id: node.id,
        originalContent: node.originalContent
      };
    });
    
    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    // 写入文件
    await fs.writeFile(outputPath, JSON.stringify(maskedNodesObj, null, 2), 'utf8');
    console.log(`掩码节点映射已保存到: ${outputPath}`);
  }
  
  /**
   * 处理原始环境（verbatim）
   * @param node verbatim节点
   * @returns 处理后的文本
   */
  private processVerbatim(node: AstTypes.Ast): string {
    // 创建掩码ID
    const maskId = this.generateMaskId('VERBATIM');
    
    // 存储原始节点
    this.maskedNodes.set(maskId, {
      id: maskId,
      originalContent: node
    });
    
    // 使用显著的标记使掩码更明显
    return ` ${this.options.maskPrefix}${maskId} `;
  }
} 