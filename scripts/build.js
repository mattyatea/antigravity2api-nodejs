import esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const bundleDir = path.join(distDir, 'bundle');
const frontendDir = path.join(rootDir, 'frontend');

// 转换为正斜杠路径（跨平台兼容）
const toSlash = (p) => p.replace(/\\/g, '/');

// 跨平台目录复制函数
const copyDir = (src, dest) => {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
};

// 确保目录存在
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}
if (!fs.existsSync(bundleDir)) {
  fs.mkdirSync(bundleDir, { recursive: true });
}

// 获取命令行参数
const args = process.argv.slice(2);
const targetArg = args.find(arg => arg.startsWith('--target='));
const target = targetArg ? targetArg.split('=')[1] : 'node18-win-x64';

// 解析目标平台
const targetMap = {
  'win': 'node18-win-x64',
  'win-x64': 'node18-win-x64',
  'linux': 'node18-linux-x64',
  'linux-x64': 'node18-linux-x64',
  'linux-arm64': 'node18-linux-arm64',
  'macos': 'node18-macos-x64',
  'macos-x64': 'node18-macos-x64',
  'macos-arm64': 'node18-macos-arm64',
  'all': 'node18-win-x64,node18-linux-x64,node18-linux-arm64,node18-macos-x64,node18-macos-arm64'
};

const resolvedTarget = targetMap[target] || target;

// 输出文件名映射
const outputNameMap = {
  'node18-win-x64': 'antigravity-win-x64.exe',
  'node18-linux-x64': 'antigravity-linux-x64',
  'node18-linux-arm64': 'antigravity-linux-arm64',
  'node18-macos-x64': 'antigravity-macos-x64',
  'node18-macos-arm64': 'antigravity-macos-arm64'
};

// 平台对应的 bin 文件映射
const binFileMap = {
  'node18-win-x64': 'antigravity_requester_windows_amd64.exe',
  'node18-linux-x64': 'antigravity_requester_linux_amd64',
  'node18-linux-arm64': 'antigravity_requester_android_arm64',
  'node18-macos-x64': 'antigravity_requester_linux_amd64',
  'node18-macos-arm64': 'antigravity_requester_android_arm64'
};

console.log('🚀 Starting build process...');

// Step 1: Build Frontend
console.log('\n📦 Step 1: Building Frontend...');
try {
  if (fs.existsSync(frontendDir)) {
    console.log('  Installing frontend dependencies...');
    execSync('npm install', { cwd: frontendDir, stdio: 'inherit' });

    console.log('  Building frontend assets...');
    execSync('npm run build', { cwd: frontendDir, stdio: 'inherit' });
    console.log('  ✅ Frontend build complete (assets in public/)');
  } else {
    console.warn('  ⚠️ Frontend directory not found, skipping frontend build.');
  }
} catch (error) {
  console.error('  ❌ Frontend build failed:', error.message);
  process.exit(1);
}

// Step 2: Bundle Server
console.log('\n📦 Step 2: Bundling Server with esbuild...');

// 使用 esbuild 打包成 CommonJS
await esbuild.build({
  entryPoints: ['src/server/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: path.join(bundleDir, 'server.cjs'),
  external: ['esbuild', 'pkg'], // 排除构建在该环境不应包含的依赖
  minify: false,
  sourcemap: false,
  // 处理 __dirname 和 __filename
  define: {
    'import.meta.url': 'importMetaUrl'
  },
  banner: {
    js: `
const importMetaUrl = require('url').pathToFileURL(__filename).href;
const __importMetaDirname = __dirname;
`
  },
  loader: {
    '.node': 'copy'
  }
});

console.log('✅ Bundle created: dist/bundle/server.cjs');

// 创建临时 package.json 用于 pkg
const pkgJson = {
  name: 'antigravity-to-openai',
  version: '1.0.0',
  bin: 'server.cjs',
  pkg: {
    assets: [
      toSlash(path.join(rootDir, 'public', '**/*')),
      toSlash(path.join(rootDir, 'public', '*.html')),
      toSlash(path.join(rootDir, 'public', '*.css')),
      toSlash(path.join(rootDir, 'public', 'js', '*.js')),
      toSlash(path.join(rootDir, 'public', 'assets', '*')),
      toSlash(path.join(rootDir, 'src', 'bin', '*'))
    ]
  }
};

fs.writeFileSync(
  path.join(bundleDir, 'package.json'),
  JSON.stringify(pkgJson, null, 2)
);

console.log('\n📦 Step 3: Building executable with pkg...');

// 执行 pkg 命令的辅助函数
function runPkg(args) {
  const quotedArgs = args.map(arg => {
    if (arg.includes(' ') || arg.includes('\\')) {
      return `"${arg.replace(/\\/g, '/')}"`;
    }
    return arg;
  });

  const cmd = `npx pkg ${quotedArgs.join(' ')}`;
  console.log(`Running: ${cmd}`);

  try {
    execSync(cmd, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: true
    });
  } catch (error) {
    throw new Error(`pkg failed: ${error.message}`);
  }
}

// 构建 pkg 命令
const targets = resolvedTarget.split(',');
const isMultiTarget = targets.length > 1;

try {
  const pkgJsonPath = path.join(bundleDir, 'package.json');

  // 清理旧文件
  if (isMultiTarget) {
    for (const t of targets) {
      const oldFile = path.join(distDir, outputNameMap[t] || 'antigravity');
      if (fs.existsSync(oldFile)) {
        fs.unlinkSync(oldFile);
      }
    }
  } else {
    const outputName = outputNameMap[resolvedTarget] || 'antigravity';
    const oldFile = path.join(distDir, outputName);
    if (fs.existsSync(oldFile)) {
      fs.unlinkSync(oldFile);
    }
  }

  if (isMultiTarget) {
    runPkg([pkgJsonPath, '--target', resolvedTarget, '--compress', 'GZip', '--out-path', distDir]);
  } else {
    const outputName = outputNameMap[resolvedTarget] || 'antigravity';
    const outputPath = path.join(distDir, outputName);

    const isArm64 = resolvedTarget.includes('arm64');
    const isWindows = process.platform === 'win32';
    const compressArgs = (isArm64 && isWindows) ? [] : ['--compress', 'GZip'];

    runPkg([pkgJsonPath, '--target', resolvedTarget, ...compressArgs, '--output', outputPath]);
  }

  console.log('✅ Build complete!');

  // 复制运行时文件
  console.log('\n📁 Step 4: Copying runtime files...');

  // 复制 public 目录
  const publicSrcDir = path.join(rootDir, 'public');
  const publicDestDir = path.join(distDir, 'public');

  if (fs.existsSync(publicDestDir)) {
    fs.rmSync(publicDestDir, { recursive: true, force: true });
  }

  // 使用 Node.js 原生 API 复制
  copyDir(publicSrcDir, publicDestDir);
  console.log('  ✓ Copied public directory');

  // 删除 images 目录
  const imagesDir = path.join(publicDestDir, 'images');
  if (fs.existsSync(imagesDir)) {
    fs.rmSync(imagesDir, { recursive: true, force: true });
  }

  // 复制 bin 目录
  const binSrcDir = path.join(rootDir, 'src', 'bin');
  const binDestDir = path.join(distDir, 'bin');

  if (fs.existsSync(binDestDir)) {
    fs.rmSync(binDestDir, { recursive: true, force: true });
  }
  fs.mkdirSync(binDestDir, { recursive: true });

  const targetBinFiles = isMultiTarget
    ? [...new Set(targets.map(t => binFileMap[t]).filter(Boolean))]
    : [binFileMap[resolvedTarget]].filter(Boolean);

  if (targetBinFiles.length > 0) {
    for (const binFile of targetBinFiles) {
      const srcPath = path.join(binSrcDir, binFile);
      const destPath = path.join(binDestDir, binFile);
      if (fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`  ✓ Copied bin/${binFile}`);
      } else {
        console.warn(`  ⚠ Warning: bin/${binFile} not found`);
      }
    }
  } else {
    // Fallback: copy all if no specific mapping
    copyDir(binSrcDir, binDestDir);
    console.log('  ✓ Copied all bin files');
  }

  // 复制 config.json
  const configSrcPath = path.join(rootDir, 'config.json');
  const configDestPath = path.join(distDir, 'config.json');
  if (fs.existsSync(configSrcPath)) {
    fs.copyFileSync(configSrcPath, configDestPath);
    console.log('  ✓ Copied config.json');
  }

  console.log('\n🎉 All build steps successful!');
  console.log(`   Output directory: ${distDir}`);

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
} finally {
  if (fs.existsSync(bundleDir)) {
    fs.rmSync(bundleDir, { recursive: true, force: true });
    // console.log('🧹 Cleaned up temporary files');
  }
}