// react-native's graphicsConversions.h calls std::format, which NDK 26's libc++
// compiles out unless _LIBCPP_ENABLE_EXPERIMENTAL is defined (react-native-executorch's
// bundled prebuilt OpenCV/kleidicv libs require NDK 26's ABI, so we can't just bump the
// NDK instead). std::to_string is a drop-in replacement here with no format() dependency.
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native',
  'ReactCommon',
  'react',
  'renderer',
  'core',
  'graphicsConversions.h'
);

const search = 'return std::format("{}%", dimension.value);';
const replacement = 'return std::to_string(dimension.value) + "%";';

const contents = fs.readFileSync(target, 'utf8');

if (contents.includes(replacement)) {
  process.exit(0);
}

if (!contents.includes(search)) {
  throw new Error(
    `scripts/patch-react-native.js: expected string not found in ${target} — react-native's graphicsConversions.h may have changed, update this patch.`
  );
}

fs.writeFileSync(target, contents.replace(search, replacement));
