/**
 * src/services/masking.service.ts
 * 
 * 原 masker.ts，负责从LaTeX AST中提取和掩码需要保护的内容
 */

// import * as fs from 'fs/promises'; // 不再需要
// import * as path from 'path'; // 不再需要
import type {
  ProjectAST,
  ProjectFileAst,
  Ast,
} from 'ast-gen';
import type { MaskingOptions, MaskedNode } from '../types';
import { toString } from '@unified-latex/unified-latex-util-to-string'; // 假设可以这样导入

export class MaskingService { // 重命名此类
  private options: Required<MaskingOptions>;
  private maskedNodes: Map<string, MaskedNode>;
  private maskCounter: number;
  
  constructor(options: Required<MaskingOptions>) { // 接收完全配置好的选项
    this.options = options;
    this.maskedNodes = new Map();
    this.maskCounter = 0;
  }
  
  /**
   * 掩码AST并生成掩码后的文本和节点映射
   * @param ast 项目AST
   * @returns 包含掩码后文本和节点映射的对象
   */
  async maskAst(ast: ProjectAST): Promise<{
    maskedText: string;
    maskedNodesMap: Map<string, MaskedNode>;
  }> {
    this.maskedNodes = new Map(); // 每次调用重置
    this.maskCounter = 0; // 每次调用重置
    let maskedText = '';
    
    // 假设 ProjectAST 保证 files 数组存在
    for (const fileAst of ast.files) {
      const fileMaskedText = this.maskFileAst(fileAst);
      if (maskedText && fileMaskedText) { // 确保两者都有内容才加分隔符
        maskedText += '\n\n'; // 文件间用双换行分隔，便于阅读
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
    let maskedText = '';
    if (fileAst.ast && fileAst.ast.type === 'root' && fileAst.ast.content) {
      maskedText = this.processNodes(fileAst.ast.content);
    }
    return maskedText;
  }
  
  private processNodes(nodes: Ast.Ast[]): string {
    let result = '';
    for (const node of nodes) {
      if (!node) continue;
      if (Array.isArray(node)) {
        result += this.processNodes(node as Ast.Ast[]);
        continue;
      }
      if (!node.type) continue;
      const nodeType = node.type.toString();
      switch (nodeType) {
        case 'string':
          result += (node as Ast.String).content;
          break;
        case 'whitespace':
          result += ' '; // 保持原始空白，尽管在翻译中可能被压缩
          break;
        case 'parbreak':
          result += '\n\n'; // 保持段落分隔
          break;
        case 'comment':
          result += this.processComment(node as Ast.Comment);
          break;
        case 'macro':
          result += this.processMacro(node as Ast.Macro);
          break;
        case 'environment': // 通用环境
        case 'mathenv': // 数学环境，如 align, equation (如果 AST-Gen 这样区分)
          result += this.processEnvironment(node as Ast.Environment); // 用一个方法处理所有环境
          break;
        case 'inlinemath':
          result += this.processInlineMath(node as Ast.InlineMath);
          break;
        case 'displaymath':
          result += this.processDisplayMath(node as Ast.DisplayMath);
          break;
        case 'verbatim': // 如 lstlisting
          result += this.processVerbatim(node as Ast.VerbatimEnvironment);
          break;
        default:
          // 特殊处理 ast-gen 可能产生的 math.inline/math.display 类型
          if (nodeType === 'math.inline') {
            result += this.processInlineMath(node as Ast.InlineMath);
          } else if (nodeType === 'math.display') {
            result += this.processDisplayMath(node as Ast.DisplayMath);
          } 
          // 尝试处理其他未知但有 content 的节点
          else if ('content' in node && Array.isArray(node.content)) {
            result += this.processNodes(node.content);
          } else if ('content' in node && typeof node.content === 'string') {
            // 如果未知节点有字符串内容，可能需要翻译，但这里是掩码阶段，通常选择保留或根据规则处理
            // 为安全起见，此处不直接添加，除非有明确规则
            // console.warn(`未知节点类型 ${nodeType} 包含字符串内容，未处理:`, node.content);
          }
      }
    }
    return result;
  }
  
  private processMacro(node: Ast.Macro): string {
    if (this.options.maskCommands && 
        this.options.maskCommands.includes(node.content)) {
      const maskId = this.generateMaskId('CMD');
      this.maskedNodes.set(maskId, { id: maskId, originalContent: node });
      return ` <ph id="${maskId}"/> `;
    }
    // 格式化命令通常需要保留其参数进行翻译，但这里简单掩码整个命令+参数
    // 细致处理：可以仅翻译参数内容，但这会使掩码和替换更复杂
    const formattingCommands = ['textbf', 'textit', 'texttt', 'textrm', 'textsc', 'emph', 'underline', 'textcolor', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph'];
    if (formattingCommands.includes(node.content)) {
      const maskId = this.generateMaskId('FMT_CMD');
      this.maskedNodes.set(maskId, { id: maskId, originalContent: node });
      return ` <ph id="${maskId}"/> `;
    }
    // 对于其他宏，递归处理其参数，但宏本身（如 \label）不应翻译
    // 如果宏参数是文本，则应该被翻译，否则（如 \includegraphics 的文件名）不应翻译
    // 目前的 processArgs 会将参数内容变为文本字符串，这适合翻译
    return `\\${node.content}${this.processArgsToString(node.args || [])}`;
  }
  
  private processEnvironment(node: Ast.Environment): string {
    if (!('env' in node)) return '';
    let envName = '';
    const envAttr = (node as any).env;
    if (typeof envAttr === 'string') envName = envAttr;
    else if (typeof envAttr === 'object' && envAttr && 'content' in envAttr) envName = envAttr.content as string;
    else if (typeof envAttr === 'object' && envAttr && 'type' in envAttr && envAttr.type === 'string' && 'content' in envAttr) envName = envAttr.content as string;
    
    if (!envName) {
      console.warn('无法确定环境名称:', node);
      return ''; // 或者返回原始内容的字符串表示?
    }

    const isRegularEnvToMask = this.options.regularEnvironments?.includes(envName);
    const isMathEnvToMask = this.options.mathEnvironments?.includes(envName) && this.options.maskDisplayMath; // 仅当maskDisplayMath为true时，数学环境才按此规则掩码

    if (isRegularEnvToMask || isMathEnvToMask) {
      const maskType = isMathEnvToMask ? 'MATH_ENV' : 'ENV';
      const maskId = this.generateMaskId(maskType);
      this.maskedNodes.set(maskId, { id: maskId, originalContent: node });
      return ` <ph id="${maskId}"/> `;
    }
    
    // 如果环境不需要掩码，则处理其内容
    let result = `\\begin{${envName}}${this.processArgsToString(node.args || [])}`;
    if (node.content && Array.isArray(node.content)) {
      result += this.processNodes(node.content);
    }
    result += `\\end{${envName}}`;
    return result;
  }
  
  private processInlineMath(node: Ast.InlineMath): string {
    if (this.options.maskInlineMath) {
      const maskId = this.generateMaskId('IMATH');
      this.maskedNodes.set(maskId, { id: maskId, originalContent: node });
      return ` <ph id="${maskId}"/> `;
    }
    // 若不掩码，则需要将其内容转换为字符串以包含在文本流中
    // 使用 unified-latex 的 toString 函数代替自定义的 nodesToString
    return `$${toString(node.content || [])}$`;
  }
  
  private processDisplayMath(node: Ast.DisplayMath): string {
    if (this.options.maskDisplayMath) {
      const maskId = this.generateMaskId('DMATH');
      this.maskedNodes.set(maskId, { id: maskId, originalContent: node });
      return ` <ph id="${maskId}"/> `;
    }
    // 使用 unified-latex 的 toString 函数代替自定义的 nodesToString
    return `\\[${toString(node.content || [])}\\]`;
  }
    
  private processComment(node: Ast.Comment): string {
    if (this.options.maskComments) {
      const maskId = this.generateMaskId('COMMENT');
      this.maskedNodes.set(maskId, { id: maskId, originalContent: node });
      return ` <ph id="${maskId}"/> `;
    }
    // 不掩码注释，则注释不应出现在待翻译文本中
    return ''; // 或者根据需要保留，但通常目标是翻译主要内容
  }
  
  // 将参数节点转换为字符串，用于宏和环境的参数部分
  private processArgsToString(args: Ast.Argument[]): string {
    if (!args || !Array.isArray(args)) return '';
    let result = '';
    for (const arg of args) {
      if (!arg || !arg.type || arg.type !== 'argument') continue;
      const openMark = arg.openMark || '';
      const closeMark = arg.closeMark || '';
      result += `${openMark}${this.nodesToString(arg.content || [])}${closeMark}`;
    }
    return result;
  }

  // 新增辅助方法：将节点数组转换为字符串，用于非掩码数学公式等
  private nodesToString(nodes: Ast.Ast[]): string {
    let s = '';
    for (const node of nodes) {
        if (!node) continue;
        if (Array.isArray(node)) {
            s += this.nodesToString(node);
            continue;
        }
        switch (node.type) {
            case 'string': s += node.content; break;
            case 'whitespace': s += ' '; break;
            case 'parbreak': s += '\n\n'; break; // 段落符在数学内容中可能不合适，但通用转换如此
            case 'comment': s += `%${node.content}\n`; break; // 注释一般在数学中不出现，但完整转换
            case 'macro': 
                s += `\\${node.content}${this.processArgsToString(node.args || [])}`;
                break;
            // 其他类型如环境、数学环境等在纯字符串转换中通常不递归处理其内容，
            // 而是取其字面表示或特定标记。但这里目标是获取其"文本"内容。
            // 此方法主要用于 $...$ 或 \[...\] 内的不被掩码的内容。
            default: 
                if ('content' in node && typeof node.content === 'string') s += node.content;
                // 对于复杂嵌套结构，此简单转换可能不足，需更复杂的序列化
                break;
        }
    }
    return s;
  }
  
  private generateMaskId(prefix: string): string {
    this.maskCounter++;
    return `${prefix}_${this.maskCounter.toString().padStart(4, '0')}`;
  }
  
  private processVerbatim(node: Ast.VerbatimEnvironment): string {
    const maskId = this.generateMaskId('VERBATIM');
    this.maskedNodes.set(maskId, { id: maskId, originalContent: node });
    return ` <ph id="${maskId}"/> `;
  }
  // saveMaskedText 和 saveMaskedNodesMap 方法定义已按计划移除
} 