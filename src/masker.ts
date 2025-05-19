/**
 * masker.ts
 * 
 * 负责从LaTeX AST中提取和掩码需要保护的内容
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ProjectAST,
  ProjectFileAst
} from 'ast-gen';

interface MaskingOptions {
  // 需要掩码的环境类型
  maskEnvironments?: string[];
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
  originalContent: any;
}

export class Masker {
  private options: MaskingOptions;
  private maskedNodes: Map<string, MaskedNode>;
  private maskCounter: number;
  
  constructor(options: MaskingOptions = {}) {
    // 默认选项
    this.options = {
      maskEnvironments: ['equation', 'align', 'figure', 'table', 'algorithm'],
      maskCommands: ['ref', 'cite', 'includegraphics', 'url'],
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
  private processNodes(nodes: any[]): string {
    let result = '';
    
    for (const node of nodes) {
      if (!node || !node.type) continue;
      
      switch (node.type) {
        case 'string':
          // 直接添加文本
          result += node.content;
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
          result += this.processMacro(node);
          break;
          
        case 'environment':
          // 处理环境
          result += this.processEnvironment(node);
          break;
          
        case 'math.inline':
          // 处理内联数学
          result += this.processInlineMath(node);
          break;
          
        case 'math.display':
          // 处理行间数学
          result += this.processDisplayMath(node);
          break;
          
        default:
          // 递归处理其他类型的节点
          if (node.content && Array.isArray(node.content)) {
            result += this.processNodes(node.content);
          } else if (node.content && typeof node.content === 'string') {
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
  private processMacro(node: any): string {
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
      return `\\${node.content}${this.processArgs(node.args)}`;
    }
    
    // 对于其他宏，包括其参数
    return `\\${node.content}${this.processArgs(node.args)}`;
  }
  
  /**
   * 处理环境
   * @param node 环境节点
   * @returns 处理后的文本
   */
  private processEnvironment(node: any): string {
    // 检查是否需要掩码这个环境
    if (node.env && this.options.maskEnvironments && 
        this.options.maskEnvironments.includes(node.env)) {
      // 创建掩码ID
      const maskId = this.generateMaskId('ENV');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 处理环境头部
    let result = `\\begin{${node.env}}`;
    
    // 添加可能的环境参数
    if (node.args && Array.isArray(node.args)) {
      result += this.processArgs(node.args);
    }
    
    // 处理环境内容
    if (node.content && Array.isArray(node.content)) {
      result += this.processNodes(node.content);
    }
    
    // 处理环境尾部
    result += `\\end{${node.env}}`;
    
    return result;
  }
  
  /**
   * 处理内联数学
   * @param node 内联数学节点
   * @returns 处理后的文本
   */
  private processInlineMath(node: any): string {
    if (this.options.maskInlineMath) {
      // 创建掩码ID
      const maskId = this.generateMaskId('IMATH');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 如果不掩码，返回原始内容
    let content = '';
    if (node.content && Array.isArray(node.content)) {
      content = this.processNodes(node.content);
    }
    return `$${content}$`;
  }
  
  /**
   * 处理行间数学
   * @param node 行间数学节点
   * @returns 处理后的文本
   */
  private processDisplayMath(node: any): string {
    if (this.options.maskDisplayMath) {
      // 创建掩码ID
      const maskId = this.generateMaskId('DMATH');
      
      // 存储原始节点
      this.maskedNodes.set(maskId, {
        id: maskId,
        originalContent: node
      });
      
      return ` ${this.options.maskPrefix}${maskId} `;
    }
    
    // 如果不掩码，返回原始内容
    let content = '';
    if (node.content && Array.isArray(node.content)) {
      content = this.processNodes(node.content);
    }
    return `\\[${content}\\]`;
  }
  
  /**
   * 处理注释
   * @param node 注释节点
   * @returns 处理后的文本
   */
  private processComment(node: any): string {
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
    return `%${node.content}\n`;
  }
  
  /**
   * 处理参数
   * @param args 参数数组
   * @returns 处理后的文本
   */
  private processArgs(args: any[]): string {
    if (!args || !Array.isArray(args)) return '';
    
    let result = '';
    
    for (const arg of args) {
      if (!arg || !arg.type) continue;
      
      // 处理不同类型的参数
      if (arg.type === 'argument') {
        const openMark = arg.openMark || '';
        const closeMark = arg.closeMark || '';
        
        if (arg.content && Array.isArray(arg.content)) {
          result += `${openMark}${this.processNodes(arg.content)}${closeMark}`;
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
        type: node.originalContent.type,
        // 不存储完整内容，只存储必要信息
        contentType: typeof node.originalContent.content
      };
    });
    
    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    // 写入文件
    await fs.writeFile(outputPath, JSON.stringify(maskedNodesObj, null, 2), 'utf8');
    console.log(`掩码节点映射已保存到: ${outputPath}`);
  }
} 