import { Injectable, NotFoundException } from '@nestjs/common';
import { createReadStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class StorageService {
  private root = path.resolve(process.env.STORAGE_DIR ?? '/data/files');

  private safe(rel: string) {
    const p = path.resolve(this.root, rel);
    if (!p.startsWith(this.root + path.sep)) {
      throw new Error('Invalid storage path');
    }
    return p;
  }

  async save(rel: string, data: Buffer, overwrite = false) {
    const p = this.safe(rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, { flag: overwrite ? 'w' : 'wx' });
  }

  async remove(rel: string) {
    await fs.rm(this.safe(rel), { force: true });
  }

  async exists(rel: string) {
    try {
      await fs.stat(this.safe(rel));
      return true;
    } catch {
      return false;
    }
  }

  stream(rel: string) {
    return createReadStream(this.safe(rel));
  }

  async streamOrFail(rel: string) {
    if (!(await this.exists(rel)))
      throw new NotFoundException('File not found');
    return this.stream(rel);
  }
}
