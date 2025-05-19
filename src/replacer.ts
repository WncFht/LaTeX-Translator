/**
 * replacer.ts
 * 
 * 负责替换翻译后的文本中的掩码节点，还原原始LaTeX内容
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectAST } from 'ast-gen';

interface MaskedNode {
  id: string;
  originalContent: any;
}

export class Replacer {
  private maskedNodesMap: Map<string, MaskedNode>;
  private maskPrefix: string;
  
  constructor(maskedNodesMap: Map<string, MaskedNode>, maskPrefix: string = 'MASK_') {
    this.maskedNodesMap = maskedNodesMap;
    this.maskPrefix = maskPrefix;
  }
  
  /**
   * 加载保存的掩码节点映射
   * @param maskedNodesMapPath 掩码节点映射文件路径
   * @param originalAst 原始AST
   */
  static async fromSavedMap(
    maskedNodesMapPath: string,
    originalAst: ProjectAST
  ): Promise<Replacer> {
    try {
      // 读取掩码节点映射文件
      const mapContent = await fs.readFile(maskedNodesMapPath, 'utf8');
      const mapData = JSON.parse(mapContent);
      
      // 重建掩码节点映射
      const maskedNodesMap = new Map<string, MaskedNode>();
      
      // 需要遍历原始AST，根据节点ID找到原始内容
      const nodesById = new Map<string, any>();
      
      // 提取所有节点
      for (const fileAst of originalAst.files) {
        if (fileAst.ast && fileAst.ast.type === 'root' && fileAst.ast.content) {
          Replacer.extractAllNodes(fileAst.ast.content, nodesById);
        }
      }
      
      // 重建掩码节点映射
      for (const [id, info] of Object.entries(mapData)) {
        const originalNode = nodesById.get(id) || null;
        
        if (originalNode) {
          maskedNodesMap.set(id, {
            id,
            originalContent: originalNode
          });
        } else {
          console.warn(`未找到ID为 ${id} 的原始节点`);
        }
      }
      
      return new Replacer(maskedNodesMap);
    } catch (error) {
      console.error('加载掩码节点映射失败:', error);
      throw error;
    }
  }
  
  /**
   * 递归提取所有节点
   * @param nodes 节点数组
   * @param nodesById 按ID存储的节点映射
   */
  private static extractAllNodes(nodes: any[], nodesById: Map<string, any>): void {
    for (const node of nodes) {
      if (!node || !node.type) continue;
      
      // 如果节点有ID，添加到映射
      if (node.id) {
        nodesById.set(node.id, node);
      }
      
      // 递归处理子节点
      if (node.content && Array.isArray(node.content)) {
        Replacer.extractAllNodes(node.content, nodesById);
      }
      
      // 处理参数
      if (node.args && Array.isArray(node.args)) {
        for (const arg of node.args) {
          if (arg.content && Array.isArray(arg.content)) {
            Replacer.extractAllNodes(arg.content, nodesById);
          }
        }
      }
    }
  }
  
  /**
   * 替换翻译后的文本中的掩码
   * @param translatedText 翻译后的文本
   * @returns 替换后的文本
   */
  replaceTranslatedText(translatedText: string): string {
    let replaced = translatedText;
    
    // 使用正则表达式查找所有掩码
    const maskRegex = new RegExp(`${this.maskPrefix}([A-Z]+_\\d+)`, 'g');
    
    // 替换所有掩码
    replaced = replaced.replace(maskRegex, (match, maskId) => {
      // 查找掩码节点
      const maskedNode = this.maskedNodesMap.get(maskId);
      
      if (!maskedNode) {
        console.warn(`未找到ID为 ${maskId} 的掩码节点`);
        return match;
      }
      
      // 转换节点为LaTeX代码
      return this.nodeToLatex(maskedNode.originalContent);
    });
    
    return replaced;
  }
  
  /**
   * 将节点转换为LaTeX代码
   * @param node AST节点
   * @returns LaTeX代码
   */
  private nodeToLatex(node: any): string {
    if (!node || !node.type) return '';
    
    switch (node.type) {
      case 'macro':
        return this.macroToLatex(node);
        
      case 'environment':
        return this.environmentToLatex(node);
        
      case 'math.inline':
        return this.inlineMathToLatex(node);
        
      case 'math.display':
        return this.displayMathToLatex(node);
        
      case 'comment':
        return `%${node.content}\n`;
        
      default:
        if (node.content && Array.isArray(node.content)) {
          return this.nodesToLatex(node.content);
        } else if (node.content && typeof node.content === 'string') {
          return node.content;
        }
        return '';
    }
  }
  
  /**
   * 将节点数组转换为LaTeX代码
   * @param nodes 节点数组
   * @returns LaTeX代码
   */
  private nodesToLatex(nodes: any[]): string {
    let result = '';
    
    for (const node of nodes) {
      result += this.nodeToLatex(node);
    }
    
    return result;
  }
  
  /**
   * 将宏命令转换为LaTeX代码
   * @param node 宏命令节点
   * @returns LaTeX代码
   */
  private macroToLatex(node: any): string {
    let result = `\\${node.content}`;
    
    // 添加参数
    if (node.args && Array.isArray(node.args)) {
      for (const arg of node.args) {
        if (arg.type === 'argument') {
          const openMark = arg.openMark || '';
          const closeMark = arg.closeMark || '';
          
          if (arg.content && Array.isArray(arg.content)) {
            result += `${openMark}${this.nodesToLatex(arg.content)}${closeMark}`;
          } else {
            result += `${openMark}${closeMark}`;
          }
        }
      }
    }
    
    return result;
  }
  
  /**
   * 将环境转换为LaTeX代码
   * @param node 环境节点
   * @returns LaTeX代码
   */
  private environmentToLatex(node: any): string {
    let result = `\\begin{${node.env}}`;
    
    // 添加环境参数
    if (node.args && Array.isArray(node.args)) {
      for (const arg of node.args) {
        if (arg.type === 'argument') {
          const openMark = arg.openMark || '';
          const closeMark = arg.closeMark || '';
          
          if (arg.content && Array.isArray(arg.content)) {
            result += `${openMark}${this.nodesToLatex(arg.content)}${closeMark}`;
          } else {
            result += `${openMark}${closeMark}`;
          }
        }
      }
    }
    
    // 添加环境内容
    if (node.content && Array.isArray(node.content)) {
      result += this.nodesToLatex(node.content);
    }
    
    // 添加环境结束标记
    result += `\\end{${node.env}}`;
    
    return result;
  }
  
  /**
   * 将内联数学转换为LaTeX代码
   * @param node 内联数学节点
   * @returns LaTeX代码
   */
  private inlineMathToLatex(node: any): string {
    let content = '';
    
    if (node.content && Array.isArray(node.content)) {
      content = this.nodesToLatex(node.content);
    }
    
    return `$${content}$`;
  }
  
  /**
   * 将行间数学转换为LaTeX代码
   * @param node 行间数学节点
   * @returns LaTeX代码
   */
  private displayMathToLatex(node: any): string {
    let content = '';
    
    if (node.content && Array.isArray(node.content)) {
      content = this.nodesToLatex(node.content);
    }
    
    return `\\[${content}\\]`;
  }
  
  /**
   * 将替换后的文本保存到文件
   * @param replacedText 替换后的文本
   * @param outputPath 输出路径
   */
  async saveReplacedText(replacedText: string, outputPath: string): Promise<void> {
    // 确保输出目录存在
    const outputDir = path.dirname(outputPath);
    await fs.mkdir(outputDir, { recursive: true });
    
    // 写入文件
    await fs.writeFile(outputPath, replacedText, 'utf8');
    console.log(`替换后的文本已保存到: ${outputPath}`);
  }
} 