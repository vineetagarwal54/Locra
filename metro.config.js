// Learn more https://docs.expo.dev/guides/monorepos/#modify-the-metro-config
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// On Windows, Metro's fallback file watcher walks all of node_modules and can
// crash with ENOENT when native build tooling creates or deletes Gradle output
// directories mid-scan. Match both Windows and POSIX separators so these paths
// are excluded before Metro tries to watch them.
config.resolver.blockList = [
  /.*[\\/]android[\\/]build(?:[\\/].*)?$/,
  /.*[\\/]android[\\/]\.gradle(?:[\\/].*)?$/,
  /.*[\\/]ios[\\/]build(?:[\\/].*)?$/,
  /.*[\\/]node_modules[\\/].*[\\/]\.gradle(?:[\\/].*)?$/,
  /.*[\\/]node_modules[\\/].*[\\/]android[\\/]build(?:[\\/].*)?$/,
  // Gradle build tooling: never bundled by Metro, and its `bin/` tree is
  // compiled/deleted by Gradle mid-build. Exclude the whole dir so Metro's
  // walker never descends into it (the unguarded fs.watch would crash on
  // ENOENT when a subdir vanishes between readdir and watch).
  /.*[\\/]node_modules[\\/]expo-modules-core[\\/]expo-module-gradle-plugin(?:[\\/].*)?$/,
];

module.exports = config;
