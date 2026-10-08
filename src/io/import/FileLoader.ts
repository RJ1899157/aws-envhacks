

export interface FileMap {
  [filename: string]: File;
}

export interface ResolvedFile {
  mainFile: File;
  fileMap: FileMap;
  extension: string;
}

export function extractFiles(items: DataTransferItemList | FileList): Promise<File[]> {
  return new Promise((resolve) => {
    const files: File[] = [];
    if (items instanceof FileList) {
      for (let i = 0; i < items.length; i++) {
        if(items[i]) files.push(items[i]!);
      }
      resolve(files);
      return;
    }

    const entries: any[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : (item as any).getAsEntry ? (item as any).getAsEntry() : null;
        if (entry) {
          entries.push(entry);
        } else {
          const f = item.getAsFile();
          if (f) files.push(f);
        }
      }
    }

    if (entries.length === 0) {
      resolve(files);
      return;
    }

    let pending = 0;
    const checkDone = () => {
      if (pending === 0) resolve(files);
    };

    const traverse = (entry: any, path: string) => {
      if (entry.isFile) {
        pending++;
        entry.file((f: File) => {
          // You could preserve path if needed, but for loaders we usually flat-map or use relative
          // We'll rename the file object to have the path if possible, or just flat map
          files.push(f);
          pending--;
          checkDone();
        });
      } else if (entry.isDirectory) {
        pending++;
        const dirReader = entry.createReader();
        dirReader.readEntries((childEntries: any[]) => {
          for (const child of childEntries) {
            traverse(child, path + entry.name + '/');
          }
          pending--;
          checkDone();
        });
      }
    };

    for (const entry of entries) {
      traverse(entry, '');
    }
  });
}

export function analyzeDrop(files: File[]): ResolvedFile | null {
  const fileMap: FileMap = {};
  for (const f of files) {
    fileMap[f.name.toLowerCase()] = f;
  }

  // Find main file
  const mainExts = ['.glb', '.gltf', '.obj', '.fbx', '.stl', '.dae', '.dxf', '.svg', '.json', '.airforce'];
  let mainFile: File | null = null;
  let extension = '';

  for (const f of files) {
    const name = f.name.toLowerCase();
    for (const ext of mainExts) {
      if (name.endsWith(ext)) {
        // Prioritize some over others?
        if (!mainFile || (ext === '.gltf' && extension === '.bin')) {
          mainFile = f;
          extension = ext;
        }
      }
    }
  }

  if (!mainFile) return null;
  return { mainFile, fileMap, extension: extension.replace('.', '') };
}

export function createBlobURLs(fileMap: FileMap): { urls: Record<string, string>, revokeAll: () => void } {
  const urls: Record<string, string> = {};
  for (const [name, file] of Object.entries(fileMap)) {
    urls[name] = URL.createObjectURL(file);
    urls[file.name] = urls[name]; // both lower and original
  }

  const revokeAll = () => {
    for (const url of Object.values(urls)) {
      URL.revokeObjectURL(url);
    }
  };

  return { urls, revokeAll };
}
