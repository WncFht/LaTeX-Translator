import { Logger, ILogObj, ISettingsParam, ILogObjMeta, IStackFrame } from "tslog";
import { ConfigService } from "../services/config_service";
import { createStream, RotatingFileStream } from "rotating-file-stream";
import * as path from "path";
import * as fs from "fs";

// Define log level type for clarity
type LogLevelString = "silly" | "trace" | "debug" | "info" | "warn" | "error" | "fatal";
const logLevelMap: { [key in LogLevelString]: number } = {
  silly: 0,
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
};

let loggerInstance: Logger<ILogObj>;

// Helper to ensure log directory exists
function ensureLogDirectoryExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function initializeLogger(): Logger<ILogObj> {
  if (loggerInstance) {
    return loggerInstance;
  }

  const configService = ConfigService.getInstance();

  // Get console log settings
  const consoleLogLevelName = configService.get<LogLevelString>("logging.console.level", "info");
  const consoleMinLevel = logLevelMap[consoleLogLevelName] ?? 3; 

  // Get file log settings
  const fileLogLevelName = configService.get<LogLevelString>("logging.file.level", "silly");
  const fileMinLevel = logLevelMap[fileLogLevelName] ?? 0;
  const fileLogPath = configService.get<string>("logging.file.path", "./logs/app.log");
  const fileLogSize = configService.get<string>("logging.file.size", "10M");
  const fileLogInterval = configService.get<string>("logging.file.interval", "1d");
  const fileLogCompress = configService.get<string | boolean>("logging.file.compress", "gzip");

  // The main logger instance. Its settings apply to the default console output.
  const loggerSettings: ISettingsParam<ILogObj> = {
    name: "LaTeX翻译器",
    minLevel: consoleMinLevel, // This logger instance controls console output level
    stylePrettyLogs: true,
    prettyLogTimeZone: "local", // This will be ignored by the template below for console
    // Template for CONSOLE (no timestamp, but includes name, file:line, methodName if available)
    prettyLogTemplate: "{{logLevelName}}\t[{{name}} {{fileNameWithLine}}:{{fileLine}} {{method}}]\t",
    prettyErrorTemplate: "\n{{errorName}} {{errorMessage}}\n错误堆栈:\n{{errorStack}}",
    // Ensure methodName is used here if desired in error stacks
    prettyErrorStackTemplate: "  • {{fileNameWithLine}}:{{fileLine}} (列:{{fileColumn}}) 方法:{{method}}\n",
    // displayFunctionName, displayInstanceName, displayFilePath are often controlled by template content
    // and whether the path resolver is active (which it is by default).
  };

  loggerInstance = new Logger<ILogObj>(loggerSettings);

  // --- Attach File Transport (JSON format, all metadata including timestamp) ---
  if (fileLogPath) {
    ensureLogDirectoryExists(fileLogPath);
    try {
      const stream: RotatingFileStream = createStream(path.basename(fileLogPath), {
        size: fileLogSize,
        interval: fileLogInterval,
        compress: fileLogCompress === true ? "gzip" : (typeof fileLogCompress === 'string' ? fileLogCompress : undefined),
        path: path.dirname(fileLogPath),
      });

      loggerInstance.attachTransport((logObjectWithMeta: ILogObj & ILogObjMeta) => {
        // Explicitly cast _meta to ILogObjMeta which should include all necessary fields.
        // However, to be super safe with a possibly inconsistent d.ts, we'll check each property.
        const meta = logObjectWithMeta._meta;

        if (meta && meta.logLevelId !== undefined && meta.logLevelId >= fileMinLevel) {
          const date = meta.date || new Date();
          const timestamp = `${date.getFullYear()}.${(date.getMonth() + 1).toString().padStart(2, "0")}.${date.getDate().toString().padStart(2, "0")} ${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date.getSeconds().toString().padStart(2, "0")}.${date.getMilliseconds().toString().padStart(3, "0")}`;
          const logLevel = meta.logLevelName || "LVL";
          const loggerName = meta.name || "";
          
          const pathInfo = meta.path as IStackFrame | undefined; // path is IStackFrame
          const fileName = pathInfo?.fileName || "";
          const fileLine = pathInfo?.fileLine?.toString() || "";
          const methodName = pathInfo?.method || ""; // Use 'method' as per IStackFrame
          
          let logArguments = "";
          const argsArray = (meta as any).argumentsArray; // Use 'as any' if argumentsArray is not on IMeta/ILogObjMeta
          if (argsArray && Array.isArray(argsArray)) {
            logArguments = argsArray.map((arg: any) => 
              typeof arg === "string" ? arg : JSON.stringify(arg)
            ).join(" ");
          }

          const loggerNamePrefix = loggerName ? `${loggerName} ` : "";
          let fileLogString = `${timestamp}\t${logLevel}\t[${loggerNamePrefix}${fileName}:${fileLine}${methodName ? " "+methodName : ""}]\t${logArguments}`;

          const errorName = (meta as any).errorName;
          const errorMessage = (meta as any).errorMessage;
          const errorStack = (meta as any).errorStack;

          if (errorName && errorMessage) {
            fileLogString += `\n  错误: ${errorName}: ${errorMessage}`;
            if (errorStack) {
              const indentedStack = String(errorStack).split('\n').map((line: string) => `    ${line}`).join('\n');
              fileLogString += `\n  错误堆栈:\n${indentedStack}`;
            }
          }
          stream.write(fileLogString.trimEnd() + "\n");
        }
      });
      loggerInstance.info(`文件日志已启用，级别: ${fileLogLevelName}, 路径: ${fileLogPath}`);
    } catch (error) {
      // Fallback to console if file stream creation fails
      console.error(`无法初始化文件日志流到 ${fileLogPath}:`, error);
      loggerInstance.error(`无法初始化文件日志流到 ${fileLogPath}:`, error);
    }
  } else {
    loggerInstance.info("文件日志路径未配置，已跳过文件日志初始化。");
  }
  
  loggerInstance.info(`控制台日志已启用，级别: ${consoleLogLevelName}`);

  return loggerInstance;
}

// 提供一个获取logger实例的函数，确保logger在ConfigService之后初始化
const getLogger = (): Logger<ILogObj> => {
  if (!loggerInstance) {
    loggerInstance = initializeLogger(); // Ensures ConfigService is ready
  }
  return loggerInstance;
};

export default getLogger(); // 导出的是 logger 实例本身，但在首次导入时会执行初始化 