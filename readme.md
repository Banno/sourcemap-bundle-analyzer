# @jkhy/sourcemap-bundle-analyzer

Read minified files emitted by a build system and analyze what sources contribute
to their size. Uses `webpack-bundle-analyzer` to visualize the output, but works
with any JS output where a `file.js.map` file exists alongside `file.js`.

## Usage
`npx @jkhy/sourcemap-bundle-analyzer --dir outputDirPath file1 file2 ...`

Automatically starts a local server to visualize the files.
If no files are specified, the entire directory is read and any JS files are shown.
Files may be partial string matches: "foo" will match "foo-9ae8742.js"

**Flags:**
  --dir path to the output folder where the js files and sourcemaps are located
  --help print usage information
  --version print version data
