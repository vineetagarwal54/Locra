const {
  withProjectBuildGradle,
  withAppBuildGradle,
} = require('expo/config-plugins')

/**
 * Root cause this fixes
 * ---------------------
 * When the Windows user profile path contains a space (e.g.
 * `C:\Users\Vineet Agarwal`), CMake/AGP invoke the NDK compiler through its 8.3
 * short path — `...\bin\CLANG_~1.EXE` (the short name of `clang++.exe`). The NDK
 * toolchain also passes `-no-canonical-prefixes`, which tells clang NOT to
 * resolve that short name back to its real filename. clang decides whether it is
 * the C or the C++ driver from argv[0]; `CLANG_~1` contains no `++`, so it runs
 * as the *C* driver and never links the C++ runtime (libc++_shared).
 *
 * Every C++ shared library then fails to link with undefined libc++/libc++abi
 * symbols (`__cxa_throw`, `operator new`, `__gxx_personality_v0`, vtables, ...),
 * e.g. in `expo-modules-core` and the app's `appmodules`.
 *
 * The fix
 * -------
 * Append `-canonical-prefixes` (last-wins over the toolchain's
 * `-no-canonical-prefixes`) to the C/C++ flags of every Android module that has
 * a native (externalNativeBuild) build. clang then canonicalizes argv[0]
 * (`CLANG_~1.EXE` -> `clang++.exe`), runs as the C++ driver, and links
 * libc++_shared again.
 *
 * This is applied globally from the root project so it also covers third-party
 * modules (expo-modules-core, react-native, llama.rn, ...). The app module's
 * native build (`appmodules`) is configured separately by the React Native
 * Gradle plugin and does not pick up the root `subprojects` hook, so the flag is
 * also injected directly into the app module's `defaultConfig`.
 * It is a no-op on machines whose paths have no spaces.
 */

const MARKER = 'withNdkCanonicalPrefixes'

const SNIPPET = `
// ${MARKER}: force clang into C++ driver mode so libc++_shared is linked.
// Needed when the toolchain path is invoked via its 8.3 short name (e.g. paths
// containing spaces) together with -no-canonical-prefixes. Harmless otherwise.
subprojects { sp ->
  ["com.android.application", "com.android.library"].each { pid ->
    sp.plugins.withId(pid) {
      sp.android {
        defaultConfig {
          externalNativeBuild {
            cmake {
              cppFlags "-canonical-prefixes"
              cFlags "-canonical-prefixes"
            }
          }
        }
      }
    }
  }
}
`

// Injected into the app module's defaultConfig, where the React Native Gradle
// plugin owns the native build.
const APP_SNIPPET = `        // ${MARKER}: see plugins/withNdkCanonicalPrefixes.js
        externalNativeBuild {
            cmake {
                cppFlags "-canonical-prefixes"
                cFlags "-canonical-prefixes"
            }
        }`

function withRootProject(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withNdkCanonicalPrefixes only supports Groovy build.gradle files.',
      )
    }
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += `\n${SNIPPET}\n`
    }
    return cfg
  })
}

function withApp(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        'withNdkCanonicalPrefixes only supports Groovy build.gradle files.',
      )
    }
    if (cfg.modResults.contents.includes(MARKER)) {
      return cfg
    }
    // Insert the externalNativeBuild block just inside `defaultConfig {`.
    const anchor = /(\n\s*defaultConfig\s*\{\s*\n)/
    if (!anchor.test(cfg.modResults.contents)) {
      throw new Error(
        'withNdkCanonicalPrefixes: could not find defaultConfig block in app build.gradle',
      )
    }
    cfg.modResults.contents = cfg.modResults.contents.replace(
      anchor,
      `$1${APP_SNIPPET}\n`,
    )
    return cfg
  })
}

module.exports = function withNdkCanonicalPrefixes(config) {
  return withApp(withRootProject(config))
}
