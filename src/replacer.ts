/**
 * replacer.ts
 * 
 * 负责替换翻译后的文本中的掩码节点，还原原始LaTeX内容
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ProjectAST, Ast } from 'ast-gen';

interface MaskedNode {
  id: string;
  originalContent: Ast.Ast;
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
      const nodesById = new Map<string, Ast.Ast>();
      
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
  private static extractAllNodes(nodes: Ast.Ast[], nodesById: Map<string, Ast.Ast>): void {
    for (const node of nodes) {
      if (!node) continue;
      
      // 如果node是数组，递归处理
      if (Array.isArray(node)) {
        Replacer.extractAllNodes(node, nodesById);
        continue;
      }
      
      // 现在我们可以安全地访问node.type
      if (!node.type) continue;
      
      // 如果节点有ID，添加到映射
      if ('id' in node && node.id) {
        nodesById.set(node.id as string, node);
      }
      
      // 递归处理子节点
      if ('content' in node && Array.isArray(node.content)) {
        Replacer.extractAllNodes(node.content, nodesById);
      }
      
      // 处理参数
      if ('args' in node && Array.isArray(node.args)) {
        for (const arg of node.args) {
          if (arg && 'content' in arg && Array.isArray(arg.content)) {
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
    // 更全面的匹配模式，可以处理掩码周围可能的空格和标点
    const maskRegex = new RegExp(`${this.maskPrefix}([A-Z_]+_\\d+)\\b`, 'g');
    
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
  private nodeToLatex(node: Ast.Ast): string {
    if (!node) return '';
    
    // 如果node是数组，处理数组中的每个节点
    if (Array.isArray(node)) {
      return this.nodesToLatex(node);
    }
    
    // 安全访问type属性
    if (!node.type) return '';
    
    // 处理节点基于其类型
    const nodeType = node.type.toString();
    
    switch (nodeType) {
      case 'root':
        // 根节点处理
        return 'content' in node && Array.isArray(node.content) ? 
          this.nodesToLatex(node.content) : '';
      
      case 'string':
        // 字符串节点处理
        if ('content' in node) {
          const content = node.content as string;
          // 特殊处理对齐符号等特殊字符
          if (content === '&') {
            return '&';
          }
          return content;
        }
        return '';
      
      case 'whitespace':
        // 空白节点处理
        return ' ';
      
      case 'parbreak':
        // 段落分隔符节点处理
        return '\n\n';
      
      case 'comment':
        // 注释节点处理
        return 'content' in node && typeof node.content === 'string' ? 
          `%${node.content}\n` : '';
      
      case 'macro':
        // 宏节点处理
        return this.macroToLatex(node as Ast.Macro);
      
      case 'environment':
      case 'mathenv':
        // 环境节点处理
        return this.environmentToLatex(node);
      
      case 'verbatim':
        // 原始环境节点处理
        if ('env' in node && 'content' in node) {
          const env = (node as any).env as string;
          const content = (node as any).content as string;
          let args = '';
          
          // 处理可能的环境参数，如语言选项
          if ('args' in node && Array.isArray(node.args) && node.args.length > 0) {
            for (const arg of node.args) {
              if (arg.type === 'argument') {
                const argument = arg as Ast.Argument;
                const openMark = argument.openMark || '';
                const closeMark = argument.closeMark || '';
                
                if (Array.isArray(argument.content)) {
                  args += `${openMark}${this.nodesToLatex(argument.content)}${closeMark}`;
                } else if (typeof argument.content === 'string') {
                  args += `${openMark}${argument.content}${closeMark}`;
                } else {
                  args += `${openMark}${closeMark}`;
                }
              }
            }
          }
          
          return `\\begin{${env}}${args}${content}\\end{${env}}`;
        }
        return '';
      
      case 'inlinemath':
        // 行内数学节点处理
        return this.inlineMathToLatex(node);
      
      case 'displaymath':
        // 行间数学节点处理
        return this.displayMathToLatex(node);
      
      case 'group':
        // 分组节点处理
        if ('content' in node && Array.isArray(node.content)) {
          return `{${this.nodesToLatex(node.content)}}`;
        }
        return '{}';
      
      case 'verb':
        // 原始文本节点处理
        if ('env' in node && 'escape' in node && 'content' in node) {
          const escape = (node as any).escape as string;
          const content = (node as any).content as string;
          return `\\verb${escape}${content}${escape}`;
        }
        return '';
      
      case 'argument':
        // 参数节点处理
        if ('content' in node && Array.isArray(node.content) &&
            'openMark' in node && 'closeMark' in node) {
          const arg = node as Ast.Argument;
          return `${arg.openMark}${this.nodesToLatex(arg.content)}${arg.closeMark}`;
        }
        return '';
      
      default:
        // 处理非标准类型（如math.inline、math.display等）
        if (nodeType === 'math.inline') {
          return this.inlineMathToLatex(node);
        } else if (nodeType === 'math.display') {
          return this.displayMathToLatex(node);
        }
        // 其他类型的处理
        else if ('content' in node && Array.isArray(node.content)) {
          return this.nodesToLatex(node.content);
        } else if ('content' in node && typeof node.content === 'string') {
          return node.content as string;
        }
        return '';
    }
  }
  
  /**
   * 将节点数组转换为LaTeX代码
   * @param nodes 节点数组
   * @returns LaTeX代码
   */
  private nodesToLatex(nodes: Ast.Ast[]): string {
    let result = '';
    
    for (const node of nodes) {
      if (!node) continue;
      
      // 如果node是数组，递归处理
      if (Array.isArray(node)) {
        result += this.nodesToLatex(node);
        continue;
      }
      
      // 所有节点类型都由nodeToLatex处理
      result += this.nodeToLatex(node);
    }
    
    return result;
  }
  
  /**
   * 将宏命令转换为LaTeX代码
   * @param node 宏命令节点
   * @returns LaTeX代码
   */
  private macroToLatex(node: Ast.Macro): string {
    // 数学环境中的特殊字符无需转义
    const mathSpecialChars = ["^", "_"];
    if (mathSpecialChars.includes(node.content)) {
      let result = node.content;
      // 处理参数
      if (node.args && Array.isArray(node.args)) {
        for (const arg of node.args) {
          if (arg.type === 'argument') {
            const argument = arg as Ast.Argument;
            const openMark = argument.openMark || '';
            const closeMark = argument.closeMark || '';
            
            if (Array.isArray(argument.content)) {
              result += `${openMark}${this.nodesToLatex(argument.content)}${closeMark}`;
            } else if (typeof argument.content === 'string') {
              result += `${openMark}${argument.content}${closeMark}`;
            } else {
              result += `${openMark}${closeMark}`;
            }
          }
        }
      }
      return result;
    }
    
    // 其他宏正常处理
    let result = `\\${node.content}`;
    
    // 添加参数
    if (node.args && Array.isArray(node.args)) {
      for (const arg of node.args) {
        if (arg.type === 'argument') {
          const argument = arg as Ast.Argument;
          const openMark = argument.openMark || '';
          const closeMark = argument.closeMark || '';
          
          if (Array.isArray(argument.content)) {
            result += `${openMark}${this.nodesToLatex(argument.content)}${closeMark}`;
          } else if (typeof argument.content === 'string') {
            result += `${openMark}${argument.content}${closeMark}`;
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
  private environmentToLatex(node: Ast.Ast): string {
    // 确保node有env属性
    if (!('env' in node)) return '';
    
    let envName = '';
    const envAttr = (node as any).env;
    
    // 处理不同结构的env属性
    if (typeof envAttr === 'string') {
      envName = envAttr;
    } else if (typeof envAttr === 'object' && envAttr !== null) {
      if ('content' in envAttr) {
        envName = envAttr.content as string;
      } else if ('type' in envAttr && envAttr.type === 'string' && 'content' in envAttr) {
        envName = envAttr.content as string;
      }
    }
    
    // 如果无法获取环境名称，记录警告并返回空字符串
    if (!envName) {
      console.warn('无法确定环境名称:', node);
      return '';
    }
    
    let result = `\\begin{${envName}}`;
    
    // 添加环境参数
    if ('args' in node && node.args && Array.isArray(node.args)) {
      for (const arg of node.args) {
        if (arg.type === 'argument') {
          const argument = arg as Ast.Argument;
          const openMark = argument.openMark || '';
          const closeMark = argument.closeMark || '';
          
          if (Array.isArray(argument.content)) {
            result += `${openMark}${this.nodesToLatex(argument.content)}${closeMark}`;
          } else if (typeof argument.content === 'string') {
            result += `${openMark}${argument.content}${closeMark}`;
          } else {
            result += `${openMark}${closeMark}`;
          }
        }
      }
    }
    
    // 添加环境内容，确保处理换行和空格
    if ('content' in node && node.content && Array.isArray(node.content)) {
      // 对于align环境等需要特别处理换行和对齐符号
      if (envName === 'align' || envName === 'align*' || envName === 'aligned') {
        // 特殊处理对齐环境
        result += '\n' + this.nodesToLatex(node.content);
      } else {
        result += this.nodesToLatex(node.content);
      }
    }
    
    // 添加环境结束标记，确保换行
    result += `\\end{${envName}}`;
    
    return result;
  }
  
  /**
   * 将内联数学转换为LaTeX代码
   * @param node 内联数学节点
   * @returns LaTeX代码
   */
  private inlineMathToLatex(node: Ast.Ast): string {
    let content = '';
    
    if ('content' in node && node.content && Array.isArray(node.content)) {
      content = this.nodesToLatex(node.content);
    } else if ('content' in node && typeof node.content === 'string') {
      content = node.content as string;
    }
    
    return `$${content}$`;
  }
  
  /**
   * 将行间数学转换为LaTeX代码
   * @param node 行间数学节点
   * @returns LaTeX代码
   */
  private displayMathToLatex(node: Ast.Ast): string {
    let content = '';
    
    if ('content' in node && node.content && Array.isArray(node.content)) {
      content = this.nodesToLatex(node.content);
    } else if ('content' in node && typeof node.content === 'string') {
      content = node.content as string;
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