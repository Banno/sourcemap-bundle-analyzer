#!/usr/bin/env node
import * as acorn from 'acorn';
import fs from 'fs/promises';
import path from 'path';
import sourceMap from 'source-map';
import minimist from 'minimist';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const argv = minimist(process.argv.slice(2));

if (argv.help) {
  process.stdout.write(`Usage: npx @jkhy/sourcemap-bundle-analyzer --dir outputDirPath file1 file2 ...

If no files are specified, the entire directory is read.
Files may be partial string matches: "foo" will match "foo-9ae8742.js"
Flags:
  --dir path to the output folder where the js files and sourcemaps are located
  --help print usage information
  --version print version data
`);
  process.exit(0);
}

if (!argv.dir && !argv.version) {
  process.stderr.write(`--dir parameter is required\n`);
  process.exit(1);
}

const require = createRequire(import.meta.url);

const webpackViewerData = [];
const webpackAnalyzer = require('webpack-bundle-analyzer/lib/analyzer.js');
webpackAnalyzer.getViewerData = function getViewerData() {
  return webpackViewerData;
};
const viewer = require('webpack-bundle-analyzer/lib/viewer.js');

const tokenizerOptions = {
  ecmaVersion: 2020,
  sourceType: 'module',
  locations: true
};

const bytesPerFile = new Map();

(async () => {
  if (argv.version) {
    const packageJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './package.json');
    const packageInfo = await fs.readFile(packageJsonPath, 'utf8');
    process.stdout.write(`Version: ${JSON.parse(packageInfo).version}\n`);
    return;
  }

  const dirpath = argv.dir + (argv.dir[argv.dir.length - 1] === path.sep ? '' : path.sep);

  let files;
  try {
    files = await fs.readdir(dirpath);
  } catch(e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
    return;
  }

  for (const filepath of files) {
    if (path.extname(filepath) !== '.js') {
      continue;
    }

    if (argv._ && argv._.length > 0 && !argv._.find((pathPart) => filepath.indexOf(pathPart) >= 0)) {
      continue;
    }

    try {
      await fs.access(`${dirpath}${filepath}.map`);
    } catch {
      process.stderr.write(`Unable to read sourcemap file: ${dirpath}${filepath}.map\n`);
      continue;
    }
    let outContents;
    let mapContents;
    let fileStats;
    try {
      outContents = await fs.readFile(`${dirpath}${filepath}`, 'utf8');
      mapContents = await fs.readFile(`${dirpath}${filepath}.map`, 'utf8');
      fileStats = await fs.stat(`${dirpath}${filepath}`);
    } catch (e) {
      process.stderr.write(`Unable to read file: ${dirpath}${filepath}\n`);
      continue;
    }
    process.stdout.write(`Adding ${dirpath}${filepath}\n`);

    await sourceMap.SourceMapConsumer.with(mapContents, null, async (sourceMapConsumer) => {
      for (let token of acorn.tokenizer(outContents, tokenizerOptions)) {
        const originalInfo = sourceMapConsumer.originalPositionFor(token.loc.start);
        const originalFilepath = originalInfo ? originalInfo.source || '**unknown**' : '**unknown**';
        let existingBytes = bytesPerFile.get(originalFilepath) || 0;
        existingBytes += token.end - token.start;
        bytesPerFile.set(originalFilepath, existingBytes);
      }
    });

    const fileInfo = [];
    bytesPerFile.forEach((bytes, filepath) => {
      let filename = filepath.replace(/^(\.\.\/)+/, '');
      fileInfo.push({
        file: filename,
        bytes
      });
    });
    fileInfo.sort((a, b) => a.file.localeCompare(b.file));

    const fullGroupInfo = new Map();
    const addToGroupInfo = (prefixPath, remainingPath, size, groupMap) => {
      const fullpath = (prefixPath || '') + remainingPath;
      const pathParts = remainingPath.split(/\//g)

      if (prefixPath === null) {
        addToGroupInfo(pathParts[0] + '/', pathParts.slice(1).join('/'), size, groupMap);
        return;
      }

      if (pathParts.length === 1) {
        groupMap.set(fullpath, {
          label: remainingPath,
          path: fullpath,
          isAsset: true,
          statSize: size,
          groups: new Map()
        });
      } else {
        let groupInfo = groupMap.get(prefixPath);
        if (!groupInfo) {
          groupInfo = {
            label: prefixPath,
            path: prefixPath,
            isAsset: true,
            groups: new Map()
          };
          groupMap.set(prefixPath, groupInfo);
        }
        addToGroupInfo(prefixPath + pathParts[0] + '/', pathParts.slice(1).join('/'), size, groupInfo.groups);
      }
    };

    fileInfo.forEach((info) => {
      addToGroupInfo(null, info.file, info.bytes, fullGroupInfo)
    });

    const getGroupData = (fullGroupInfo) => {
      const groupArray = Array.from(fullGroupInfo);
      return groupArray.map(([key, value]) => {
        if (value.groups.size === 0) {
          value.groups = undefined;
          return value;
        }
        if (value.groups.size === 1 && value.statSize === 0) {
          return getGroupData(value.groups)[0];
        }
        value.groups = getGroupData(value.groups);
        if (value.statSize === undefined) {
          if (!value.groups) {
            value.statSize = 0;
          } else {
            value.statSize = value.groups.reduce((sum, currValue) => sum + (currValue.statSize || 0), 0);
          }
        }
        return value;
      });
    };
    webpackViewerData.push({
      label: filepath,
      path: filepath,
      isAsset: true,
      statSize: fileStats.size,
      parsedSize: undefined,
      gzipSize: undefined,
      groups: getGroupData(fullGroupInfo)
    });
  }
  viewer.start();
})();
