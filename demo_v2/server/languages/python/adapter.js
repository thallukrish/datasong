import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`Python AST analyzer failed with ${command} exit ${code}: ${stderr.trim()}`));
      try { resolve(JSON.parse(stdout || '{}')); }
      catch (error) { reject(new Error(`Python AST analyzer returned invalid JSON: ${error.message}`)); }
    });
    child.stdin.end(input);
  });
}

export async function analyzePythonRepository({ repoDir, files }) {
  const pythonFiles = (Array.isArray(files) ? files : []).filter((file) => String(file).toLowerCase().endsWith('.py'));
  if (!pythonFiles.length) return { version: 1, symbols: [] };

  const script = new URL('./analyzer.py', import.meta.url);
  const args = [fileURLToPath(script), repoDir];
  const input = JSON.stringify(pythonFiles);
  const commands = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  let lastError = null;
  for (const command of commands) {
    try {
      const commandArgs = command === 'py' ? ['-3', ...args] : args;
      return await run(command, commandArgs, input);
    } catch (error) {
      lastError = error;
      if (!/ENOENT|not found|cannot find/i.test(String(error?.message || ''))) throw error;
    }
  }
  throw lastError || new Error('Python 3 executable not found');
}
