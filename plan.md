# LaTeX AST 解析器项目计划

## 项目目标

创建一个基于AST-Gen包的LaTeX解析器应用程序，能够：

1. 接受文件路径或文件夹路径作为输入
2. 解析LaTeX文件或项目并生成抽象语法树(AST)
3. 将AST输出为JSON格式
4. 支持自定义宏处理和错误报告

## 技术架构

### 依赖

- AST-Gen包
- Node.js
- TypeScript

### 主要组件

1. **命令行接口**: 处理用户输入参数
2. **解析器核心**: 使用AST-Gen提供的API解析LaTeX文件
3. **输出格式化**: 处理AST输出格式和保存

## 详细设计

### 目录结构

```
LaTeX-Translator/
├── src/
│   ├── index.ts       # 项目入口点
│   ├── cli.ts         # 命令行处理逻辑
│   ├── translator.ts  # AST-Gen包装类
│   └── utils.ts       # 工具函数
├── dist/              # 编译后的JavaScript文件
├── package.json       # 项目配置
├── tsconfig.json      # TypeScript配置
└── README.md          # 使用说明
```

### 组件API设计

#### 1. Translator类

```typescript
class Translator {
  /**
   * 解析单个LaTeX文件或项目
   * @param path 文件或文件夹路径
   * @param options 解析选项
   * @returns 解析后的AST对象
   */
  async parse(path: string, options?: ParserOptions): Promise<ProjectAST>;
  
  /**
   * 将AST保存为JSON文件
   * @param ast 项目AST
   * @param outputPath 输出文件路径
   * @param pretty 是否美化输出
   */
  saveAsJson(ast: ProjectAST, outputPath: string, pretty?: boolean): Promise<void>;
}
```

#### 2. 命令行接口

```
用法: latex-translator <输入路径> [选项]

选项:
  -o, --output <文件路径>  指定输出JSON文件的路径
  -p, --pretty             美化JSON输出
  -m, --macros <文件路径>  指定包含自定义宏定义的JSON文件
  -h, --help               显示帮助信息
```

## 实现计划

1. 创建项目结构和配置文件
2. 实现核心Translator类，封装AST-Gen功能
3. 实现命令行接口
4. 添加错误处理和日志记录
5. 进行测试和优化

## 测试计划

1. 单元测试: 测试主要功能模块
2. 集成测试: 使用示例LaTeX文件测试整个流程
3. 使用提供的测试文件进行验证：
   - `test_files/example.tex`
   - `test_files/main.tex`

## 实现步骤

1. 初始化项目：创建package.json和tsconfig.json
2. 安装依赖：AST-Gen包和必要的开发工具
3. 创建核心组件代码
4. 实现命令行接口
5. 编写测试和文档
6. 验证与示例文件的兼容性
