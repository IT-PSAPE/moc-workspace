import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'apps', 'packages', 'package.json', 'package-lock.json'], { encoding:'utf8' })
 .split('\0').filter(Boolean).filter(path => !path.split('/').some(part => part === 'data' || part === 'dist' || part === 'node_modules' || part.startsWith('.env'))).sort();
const hash = createHash('sha256'); let count=0;
for (const path of files) {
 try { if (!statSync(path).isFile()) continue; } catch { continue; }
 hash.update(path); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0'); count++;
}
console.log(JSON.stringify({ sourceSha256:hash.digest('hex'), sourceFiles:count }));
