/**
 * src/utils/latex.utils.ts
 * 
 * LaTeX 处理相关的通用辅助函数。
 */
import * as path from 'path';

/**
 * 判断文件是否为 TeX 相关文件。
 * @param filePath 文件路径
 * @param extensions 要检查的扩展名数组
 * @returns 如果是 TeX 文件则返回 true，否则返回 false
 */
export function isTexFile(filePath: string, extensions: string[] = ['.tex', '.ltx', '.latex']): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return extensions.includes(ext);
}

/**
 * 向 LaTeX 内容中添加中文支持包。
 * @param texContent LaTeX 文档内容
 * @returns 添加了 ctex 包（如果需要）的 LaTeX 内容
 */
export function addChineseSupport(texContent: string): string {
  // 1. 更精确地检测 ctex 是否已经加载 (作为包或文档类)
  //    检查 \usepackage{...ctex...} (ctex 作为包名的一部分，\b确保是整个单词)
  //    或者 \documentclass{ctexart/ctexrep/ctexbook}
  const usePackageCtexPattern = /\\usepackage(?:\\s*\\([^\\)]*\\))?\\s*(?:\\{[^\\}]*?\\bctex\\b[^\\}]*?\\})/m;
  const docClassCtexPattern = /\\documentclass(?:\\s*\\([^\\)]*\\))?\\s*(?:\\{\\s*(?:ctexart|ctexrep|ctexbook)\\s*\\})/m;

  if (usePackageCtexPattern.test(texContent) || docClassCtexPattern.test(texContent)) {
    return texContent;
  }

  // 2. 逐行分析以找到最佳插入点
  const lines = texContent.split('\n');
  let docClassIndex = -1;        // \documentclass 所在的行号
  let lastUsePackageIndex = -1;  // 最后一个 \usepackage 所在的行号

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimStart(); // 忽略行首空格
    if (line.startsWith('\\documentclass')) {
      docClassIndex = i;
    }
    if (line.startsWith('\\usepackage')) {
      lastUsePackageIndex = i;
    }
  }

  // 3. 如果没有找到 \documentclass，则假定为非主文件或片段，不作修改
  if (docClassIndex === -1) {
    return texContent;
  }

  const ctexPackageLine = '\\usepackage[UTF8]{ctex}';
  let insertionLineNumber = -1;

  // 4. 决定插入行号
  //    优先插入到最后一个 \usepackage 之后
  if (lastUsePackageIndex !== -1) {
    // 确保 \usepackage 在 \documentclass 之后 (正常的文档结构)
    if (lastUsePackageIndex > docClassIndex) {
      insertionLineNumber = lastUsePackageIndex + 1;
    } else {
      // 如果 \usepackage 出现在 \documentclass 之前或同一行 (不太规范，但做兼容)
      // 此时还是选择在 \documentclass 后插入，更安全
      insertionLineNumber = docClassIndex + 1;
    }
  } else {
    // 没有找到 \usepackage，则插入到 \documentclass 之后
    insertionLineNumber = docClassIndex + 1;
  }

  // 5. 插入 ctex 包声明
  //    如果 insertionLineNumber 正好是 lines.length，splice 会将其添加到末尾
  lines.splice(insertionLineNumber, 0, ctexPackageLine);

  return lines.join('\n');
}

/**
 * 获取文件相对于项目根目录的路径。
 * @param absoluteFilePath 文件的绝对路径
 * @param projectRootPath 项目根目录的绝对路径
 * @returns 相对路径
 */
export function getRelativePath(absoluteFilePath: string, projectRootPath: string): string {
  if (!projectRootPath) {
    console.error('CRITICAL: projectRootPath 未提供给 getRelativePath。'); // 中文注释
    // Fallback behavior: 可能是单文件项目，直接返回文件名
    return path.basename(absoluteFilePath);
  }

  const relativePath = path.relative(projectRootPath, absoluteFilePath);

  // 检查相对路径是否向上超出了项目根目录，或者仍然是绝对路径（异常情况）
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    console.warn(
      `文件路径 ${absoluteFilePath} 不能正确地相对于项目根目录 ${projectRootPath} 解析。` + // 中文注释
      `计算得到的相对路径: ${relativePath}。将回退到使用文件名。` // 中文注释
    );
    return path.basename(absoluteFilePath);
  }
  
  // 如果文件本身就是项目根目录（例如，单文件作为输入，且 projectRootPath 就是该文件所在的目录）
  // 且 absoluteFilePath 指向该文件，则 relativePath 可能是文件名。
  // 如果 absoluteFilePath 和 projectRootPath 相同（例如，都是目录），relativePath 会是空的。
  if (relativePath === '') {
      // 通常意味着 absoluteFilePath 和 projectRootPath 指向同一个位置。
      // 如果它们都是目录，这不符合预期（函数期望 absoluteFilePath 是文件）。
      // 如果 absoluteFilePath 是一个文件，而 projectRootPath 是其父目录，那么 relativePath 应该是文件名。
      // 如果 relativePath 为空是因为它们指向同一个文件，那么返回文件名是合适的。
      return path.basename(absoluteFilePath);
  }

  return relativePath;
} 