/**
 * src/services/file.service.ts
 * 
 * 封装所有文件系统操作。
 */
import * as fsPromises from 'fs/promises';
import { Stats, Dirent } from 'fs';
import * as path from 'path';

export class FileService {
  private static instance: FileService;

  private constructor() { }

  public static getInstance(): FileService {
    if (!FileService.instance) {
      FileService.instance = new FileService();
    }
    return FileService.instance;
  }

  async readFile(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
    return fsPromises.readFile(filePath, encoding);
  }

  async writeFile(filePath: string, data: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
    // 写入前确保目录存在
    const dir = path.dirname(filePath);
    await this.mkdirRecursive(dir);
    return fsPromises.writeFile(filePath, data, encoding);
  }

  async mkdirRecursive(dirPath: string): Promise<string | undefined> {
    return fsPromises.mkdir(dirPath, { recursive: true });
  }

  async copyFile(src: string, dest: string): Promise<void> {
    // 复制前确保目标目录存在
    const destDir = path.dirname(dest);
    await this.mkdirRecursive(destDir);
    return fsPromises.copyFile(src, dest);
  }

  async stat(filePath: string): Promise<Stats> {
    return fsPromises.stat(filePath);
  }

  async readdir(dirPath: string, options?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
    if (options?.withFileTypes) {
        return fsPromises.readdir(dirPath, { withFileTypes: true }) as Promise<Dirent[]>;
    }
    return fsPromises.readdir(dirPath);
  }

  /**
   * 递归复制目录内容。
   * @param src 源目录
   * @param dest 目标目录
   */
  async copyDirectoryRecursive(src: string, dest: string): Promise<void> {
    await this.mkdirRecursive(dest); // 确保目标根目录存在
    const entries = await fsPromises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectoryRecursive(srcPath, destPath);
      } else {
        await this.copyFile(srcPath, destPath); // copyFile 内部会处理目标子目录创建
      }
    }
  }

  // 其他需要的文件操作可以继续添加，例如：
  // async fileExists(filePath: string): Promise<boolean> {
  //   try {
  //     await fsPromises.access(filePath);
  //     return true;
  //   } catch {
  //     return false;
  //   }
  // }

  // async deleteFile(filePath: string): Promise<void> {
  //   return fsPromises.unlink(filePath);
  // }
} 