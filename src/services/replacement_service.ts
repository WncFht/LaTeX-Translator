/**
 * src/services/replacement.service.ts
 * 
 * 原 replacer.ts，负责替换翻译后的文本中的掩码节点，还原原始LaTeX内容
 */

// import * as fs from 'fs/promises'; // 不再需要
// import * as path from 'path'; // 不再需要
import { Ast } from 'ast-gen'; // ProjectAST 可能不需要了，因为不处理整个项目
import type { MaskedNode } from '../types';
import { toString } from '@unified-latex/unified-latex-util-to-string';
import log from '../utils/logger'; // 引入日志服务

export class ReplacementService { // 重命名此类
  private maskedNodesMap: Map<string, MaskedNode>;
  
  constructor(maskedNodesMap: Map<string, MaskedNode>) {
    this.maskedNodesMap = maskedNodesMap;
  }
  
  // fromSavedMap 方法已按计划移除
  // extractAllNodes 静态方法如果不再被 fromSavedMap 使用，也可以考虑移除或设为私有（如果其他地方也不用）
  // 目前看 extractAllNodes 是 fromSavedMap 独占的，所以也移除

  /**
   * 替换翻译后的文本中的掩码
   * @param translatedText 翻译后的文本
   * @returns 替换后的文本
   */
  replaceTranslatedText(translatedText: string): string {
    let replaced = translatedText;
    const maskRegex = /<ph\s+id\s*=\s*"([A-Z_]+_\d+)"\s*\/>/g;
    
    replaced = replaced.replace(maskRegex, (match, maskId) => {
      const maskedNode = this.maskedNodesMap.get(maskId);
      
      if (!maskedNode) {
        log.warn(`未找到ID为 ${maskId} 的掩码节点`); // 中文注释
        return match; // 返回原始匹配（整个 <ph ... /> 标签）
      }
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
    if (Array.isArray(node)) {
      return this.nodesToLatex(node);
    }
    if (!node.type) return '';
    const nodeType = node.type.toString();
    
    switch (nodeType) {
      case 'root':
        return 'content' in node && Array.isArray(node.content) ? 
          this.nodesToLatex(node.content) : '';
      case 'string':
        if ('content' in node) {
          const content = node.content as string;
          return content === '&' ? '&' : content; // 特殊处理 & 符号
        }
        return '';
      case 'whitespace':
        return ' ';
      case 'parbreak':
        return '\n\n';
      case 'comment':
        return 'content' in node && typeof node.content === 'string' ? 
          `%${node.content}\n` : '';
      case 'macro':
        return this.macroToLatex(node as Ast.Macro);
      case 'environment':
      case 'mathenv':
        return this.environmentToLatex(node);
      case 'verbatim':
        if ('env' in node && 'content' in node) {
          const env = (node as any).env as string;
          const content = (node as any).content as string;
          let argsString = '';
          if ('args' in node && Array.isArray(node.args) && node.args.length > 0) {
            argsString = this.argsToLatex(node.args as Ast.Argument[]);
          }
          return `\\begin{${env}}${argsString}${content}\\end{${env}}`;
        }
        return '';
      case 'inlinemath':
        return this.inlineMathToLatex(node);
      case 'displaymath':
        return this.displayMathToLatex(node);
      case 'group':
        if ('content' in node && Array.isArray(node.content)) {
          return `{${this.nodesToLatex(node.content)}}`;
        }
        return '{}';
      case 'verb':
        if ('env' in node && 'escape' in node && 'content' in node) {
          const escape = (node as any).escape as string;
          const content = (node as any).content as string;
          return `\\verb${escape}${content}${escape}`;
        }
        return '';
      case 'argument': // 参数节点本身不应直接转换，而是其内容
        if ('content' in node && Array.isArray(node.content) &&
            'openMark' in node && 'closeMark' in node) {
          const arg = node as Ast.Argument;
          return `${arg.openMark}${this.nodesToLatex(arg.content)}${arg.closeMark}`;
        }
        return ''; 
      default:
        if (nodeType === 'math.inline') return this.inlineMathToLatex(node);
        if (nodeType === 'math.display') return this.displayMathToLatex(node);
        if ('content' in node && Array.isArray(node.content)) return this.nodesToLatex(node.content);
        if ('content' in node && typeof node.content === 'string') return node.content as string;
        log.debug(`未知节点类型 ${nodeType} 无法转换为LaTeX。节点:`, node);
        return '';
    }
  }
  
  private nodesToLatex(nodes: Ast.Ast[]): string {
    return nodes.map(node => this.nodeToLatex(node)).join('');
  }
  
  private argsToLatex(args: Ast.Argument[]): string {
    return args.map(arg => {
        if (arg.type === 'argument') {
            const openMark = arg.openMark || '';
            const closeMark = arg.closeMark || '';
            return `${openMark}${this.nodesToLatex(arg.content || [])}${closeMark}`;
        }
        return ''; // 或其他处理方式
    }).join('');
  }

  private macroToLatex(node: Ast.Macro): string {
    const mathSpecialChars = ["^", "_"];
    if (mathSpecialChars.includes(node.content)) {
      let result = node.content;
      if (node.args && Array.isArray(node.args)) {
        result += this.argsToLatex(node.args as Ast.Argument[]);
      }
      return result;
    }
    return `\\${node.content}${this.argsToLatex(node.args || [])}`;
  }
  
  private environmentToLatex(node: Ast.Ast): string {
    if (!('env' in node)) return '';
    let envName = '';
    const envAttr = (node as any).env;
    if (typeof envAttr === 'string') envName = envAttr;
    else if (typeof envAttr === 'object' && envAttr && 'content' in envAttr) envName = envAttr.content as string;
    else if (typeof envAttr === 'object' && envAttr && 'type' in envAttr && envAttr.type === 'string' && 'content' in envAttr) envName = envAttr.content as string;
    
    if (!envName) {
      log.warn('无法确定环境名称:', node);
      return '';
    }
    
    let result = `\\begin{${envName}}${this.argsToLatex((node as any).args || [])}`;
    if ('content' in node && node.content && Array.isArray(node.content)) {
      if (envName === 'align' || envName === 'align*' || envName === 'aligned') {
        result += '\n' + this.nodesToLatex(node.content);
      } else {
        result += this.nodesToLatex(node.content);
      }
    }
    result += `\\end{${envName}}`;
    return result;
  }
  
  private inlineMathToLatex(node: Ast.Ast): string {
    let content = '';
    if ('content' in node && node.content && Array.isArray(node.content)) {
      content = toString(node.content);
    } else if ('content' in node && typeof node.content === 'string') {
      content = node.content as string;
    }
    return `$${content}$`;
  }
  
  private displayMathToLatex(node: Ast.Ast): string {
    let content = '';
    if ('content' in node && node.content && Array.isArray(node.content)) {
      content = toString(node.content);
    } else if ('content' in node && typeof node.content === 'string') {
      content = node.content as string;
    }
    return `\\[${content}\\]`;
  }
  // saveReplacedText 方法已按计划移除
} 